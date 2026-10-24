#!/usr/bin/env node
/**
 * Xbox AI Controller - Model Context Protocol (MCP) Server
 * Stdio JSON-RPC 2.0 server supporting Antigravity, Claude Desktop, Cursor, and any MCP client.
 */

const { loadConfig, saveConfig } = require("./config");
const { discover, powerOn, ping, sendButton, sendMedia, sendVolume, powerOffLocal, recordDvr } = require("./smartglass");
const { getDeviceList, fetchInstalledApps, launchByProductId, goHome, powerOffCloud } = require("./xccs");
const { requestDeviceCode, pollForToken } = require("./auth");
const { resolveAppOrGame } = require("./database");

const TOOLS = [
  {
    name: "xbox_discover",
    description: "Scans the local network (UDP 5050) for Xbox One or Xbox Series consoles, automatically retrieving and saving IP address, console name, and Live Device ID.",
    inputSchema: {
      type: "object",
      properties: {
        timeout_seconds: { type: "number", description: "Scan timeout in seconds (default: 3)." },
        auto_save_first: { type: "boolean", description: "Automatically save the first found console to config (default: true)." },
      },
    },
  },
  {
    name: "xbox_power_on",
    description: "Powers ON an Xbox console from standby/sleep mode over local Wi-Fi/LAN using the SmartGlass wake packet protocol.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
        live_device_id: { type: "string", description: "Xbox Live Device ID (optional if saved in config)." },
        tries: { type: "number", description: "Number of wake packets to send (default: 5)." },
      },
    },
  },
  {
    name: "xbox_power_off",
    description: "Powers OFF an Xbox console or puts it into Standby/Sleep mode.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
    },
  },
  {
    name: "xbox_ping",
    description: "Pings an Xbox console on port 5050 to check if it is online, awake, and actively responding on the network.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
    },
  },
  {
    name: "xbox_launch",
    description: "1-Click launches any game or application (e.g. FC 25, Minecraft, YouTube, Netflix, Spotify) or returns to the Home screen.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Game name, app name, or Product ID (e.g. 'FC 25', 'Minecraft', 'YouTube', 'Netflix', 'Home').",
        },
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
      required: ["target"],
    },
  },
  {
    name: "xbox_installed_apps",
    description: "Fetches the full list of installed games and applications from the console.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xbox_button",
    description: "Sends controller buttons to the console: 'a', 'b', 'x', 'y', 'up', 'down', 'left', 'right', 'nexus' (Guide button), 'view' (Back), 'menu' (Start).",
    inputSchema: {
      type: "object",
      properties: {
        button: {
          type: "string",
          description: "Button to press: 'a', 'b', 'x', 'y', 'up', 'down', 'left', 'right', 'nexus', 'view', 'menu'.",
        },
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
      required: ["button"],
    },
  },
  {
    name: "xbox_media",
    description: "Controls media playback on the console: 'play', 'pause', 'playpause', 'stop', 'next_track', 'prev_track', 'fast_forward', 'rewind'.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Media action: 'play', 'pause', 'playpause', 'stop', 'next_track', 'prev_track', 'fast_forward', 'rewind'.",
        },
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
      required: ["command"],
    },
  },
  {
    name: "xbox_volume",
    description: "Adjusts TV or soundbar volume via the console's HDMI-CEC: 'volume_up', 'volume_down', or 'mute'.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Volume action: 'volume_up', 'volume_down', or 'mute'.",
        },
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
      required: ["command"],
    },
  },
  {
    name: "xbox_record_dvr",
    description: "Triggers the 'Record that!' command to save the last 30 to 60 seconds of gameplay.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string", description: "Target IP address (optional if saved in config)." },
      },
    },
  },
  {
    name: "xbox_auth_device_code",
    description: "Initiates a safe Microsoft Device-Code login (bypassing 2FA). Gives a verification URL (microsoft.com/link) and a short code.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xbox_get_config",
    description: "Inspects the saved configuration, console details, and authentication status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xbox_set_config",
    description: "Updates console IP, Live Device ID, name, or authentication tokens manually.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string", description: "Local IP address of the Xbox." },
        live_device_id: { type: "string", description: "Xbox Live Device ID (Settings > System > Console Info)." },
        name: { type: "string", description: "Friendly name for the console." },
        user_hash: { type: "string", description: "Xbox Live User Hash (uhs)." },
        xsts_token: { type: "string", description: "Xbox Live XSTS Token." },
      },
    },
  },
];

async function handleToolCall(name, args = {}) {
  const cfg = loadConfig();

  if (name === "xbox_discover") {
    const timeout = (args.timeout_seconds || 3) * 1000;
    const res = await discover(timeout);
    if (args.auto_save_first !== false && res.consoles && res.consoles.length > 0) {
      const first = res.consoles[0];
      cfg.ip = first.ip || cfg.ip;
      if (first.live_device_id) cfg.live_device_id = first.live_device_id;
      if (first.name) cfg.name = first.name;
      saveConfig(cfg);
      res.auto_saved = { ip: cfg.ip, live_device_id: cfg.live_device_id, name: cfg.name };
    }
    return res;
  }

  if (name === "xbox_power_on") {
    const targetIp = args.ip || cfg.ip;
    const targetId = args.live_device_id || cfg.live_device_id;
    if (!targetIp || !targetId) {
      return {
        status: "missing_configuration",
        message: "Target IP or Live Device ID is missing. Run 'xbox_discover' on your local network.",
      };
    }
    return await powerOn(targetIp, targetId, args.tries || 5);
  }

  if (name === "xbox_power_off") {
    if (cfg.user_hash && cfg.xsts_token) {
      try {
        return await powerOffCloud(cfg);
      } catch (_) {}
    }
    return await powerOffLocal(args.ip);
  }

  if (name === "xbox_ping") {
    const targetIp = args.ip || cfg.ip;
    if (!targetIp) throw new Error("No Xbox IP configured.");
    return await ping(targetIp);
  }

  if (name === "xbox_launch") {
    const target = (args.target || "").trim();
    if (target.toLowerCase() === "home" || target.toLowerCase() === "dashboard") {
      if (cfg.user_hash && cfg.xsts_token) {
        try {
          return await goHome(cfg);
        } catch (_) {}
      }
      return await sendButton("nexus", args.ip);
    }

    const resolved = resolveAppOrGame(target);
    if (cfg.user_hash && cfg.xsts_token && resolved.productId) {
      return await launchByProductId(resolved.productId, cfg);
    }

    return {
      status: "requires_auth",
      message: `Direct launching for '${resolved.name}' requires Xbox Live authentication. Run 'xbox_auth_device_code' to link your account via microsoft.com/link.`,
      resolved,
    };
  }

  if (name === "xbox_installed_apps") {
    return await fetchInstalledApps(cfg);
  }

  if (name === "xbox_button") {
    return await sendButton(args.button, args.ip);
  }

  if (name === "xbox_media") {
    return await sendMedia(args.command, args.ip);
  }

  if (name === "xbox_volume") {
    return await sendVolume(args.command, args.ip);
  }

  if (name === "xbox_record_dvr") {
    return await recordDvr(args.ip);
  }

  if (name === "xbox_auth_device_code") {
    const deviceCodeRes = await requestDeviceCode();
    // Start background poller that will save tokens once approved
    pollForToken(deviceCodeRes.device_code, deviceCodeRes.interval).catch(() => {});
    return deviceCodeRes;
  }

  if (name === "xbox_get_config") {
    return {
      status: "config_loaded",
      config: {
        ip: cfg.ip,
        live_device_id: cfg.live_device_id,
        name: cfg.name,
        has_auth_tokens: !!(cfg.user_hash && cfg.xsts_token),
      },
    };
  }

  if (name === "xbox_set_config") {
    if (args.ip !== undefined) cfg.ip = args.ip.trim();
    if (args.live_device_id !== undefined) cfg.live_device_id = args.live_device_id.trim();
    if (args.name !== undefined) cfg.name = args.name.trim();
    if (args.user_hash !== undefined) cfg.user_hash = args.user_hash.trim();
    if (args.xsts_token !== undefined) cfg.xsts_token = args.xsts_token.trim();
    saveConfig(cfg);
    return { status: "config_saved", config: cfg };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// --- JSON-RPC 2.0 Stdio Transport (Dual Framing Support) ---
let useContentLengthFraming = false;
let stdinBuffer = Buffer.alloc(0);

function sendJsonRpc(msg) {
  const jsonStr = JSON.stringify(msg);
  if (useContentLengthFraming) {
    const header = `Content-Length: ${Buffer.byteLength(jsonStr, "utf8")}\r\n\r\n`;
    process.stdout.write(header + jsonStr);
  } else {
    process.stdout.write(jsonStr + "\n");
  }
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  if (method === "initialize") {
    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "xbox-ai-controller", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    });
    return;
  }

  if (method === "tools/call") {
    try {
      const toolName = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      const result = await handleToolCall(toolName, toolArgs);
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      });
    } catch (err) {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message || String(err) },
      });
    }
    return;
  }

  if (id !== undefined) {
    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

function processBuffer() {
  while (stdinBuffer.length > 0) {
    const headerEndIndex = stdinBuffer.indexOf("\r\n\r\n");
    if (headerEndIndex !== -1) {
      const headerStr = stdinBuffer.slice(0, headerEndIndex).toString("utf8");
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (match) {
        useContentLengthFraming = true;
        const contentLength = parseInt(match[1], 10);
        const bodyStartIndex = headerEndIndex + 4;
        if (stdinBuffer.length >= bodyStartIndex + contentLength) {
          const bodyBuf = stdinBuffer.slice(bodyStartIndex, bodyStartIndex + contentLength);
          stdinBuffer = stdinBuffer.slice(bodyStartIndex + contentLength);
          try {
            const parsed = JSON.parse(bodyBuf.toString("utf8"));
            handleMessage(parsed);
          } catch (_) {}
          continue;
        }
      }
    }

    const newlineIndex = stdinBuffer.indexOf("\n");
    if (newlineIndex !== -1) {
      const lineBuf = stdinBuffer.slice(0, newlineIndex);
      stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
      const lineStr = lineBuf.toString("utf8").trim();
      if (lineStr.length > 0) {
        try {
          const parsed = JSON.parse(lineStr);
          handleMessage(parsed);
        } catch (_) {}
      }
      continue;
    }

    break;
  }
}

process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  processBuffer();
});

process.stdin.on("end", () => process.exit(0));

process.on("uncaughtException", (err) => {
  process.stderr.write(`[XboxMCP UncaughtException] ${err.stack || err}\n`);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[XboxMCP UnhandledRejection] ${reason}\n`);
});
