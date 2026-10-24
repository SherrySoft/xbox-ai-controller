/**
 * SmartGlass Protocol Engine (UDP Port 5050)
 * Handles local LAN discovery, remote wake-up, virtual gamepad buttons, media, and TV volume
 */

const dgram = require("dgram");
const os = require("os");
const { loadConfig } = require("./config");

const XBOX_PORT = 5050;

function getBroadcastAddresses() {
  const broadcasts = ["255.255.255.255"];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal && iface.netmask) {
        const ipParts = iface.address.split(".").map(Number);
        const maskParts = iface.netmask.split(".").map(Number);
        const broadcastParts = ipParts.map((part, i) => part | (~maskParts[i] & 255));
        broadcasts.push(broadcastParts.join("."));
      }
    }
  }
  return [...new Set(broadcasts)];
}

function readSGString(buf, offset) {
  if (offset + 2 > buf.length) return { str: "", nextOffset: offset };
  const len = buf.readUInt16BE(offset);
  offset += 2;
  if (offset + len > buf.length) return { str: "", nextOffset: offset };
  const str = buf.slice(offset, offset + len).toString("utf8");
  offset += len;
  if (offset < buf.length && buf[offset] === 0) offset++;
  return { str, nextOffset: offset };
}

/**
 * Scan local subnet for active or sleeping Xbox consoles
 */
function discover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const consoles = [];
    const socket = dgram.createSocket("udp4");
    const discoveryPayload = Buffer.from("dd00000a000000000000000800000002", "hex");
    let timer = null;

    socket.on("error", (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      resolve({ status: "error", error: err.message, consoles: [] });
    });

    socket.on("message", (msg, rinfo) => {
      try {
        if (msg.length >= 4 && msg[0] === 0xdd && msg[1] === 0x01) {
          let offset = 16;
          const nameResult = readSGString(msg, offset);
          offset = nameResult.nextOffset;
          const idResult = readSGString(msg, offset);

          const consoleInfo = {
            ip: rinfo.address,
            port: rinfo.port,
            name: nameResult.str || "Xbox One",
            live_device_id: idResult.str || "",
          };

          if (!consoles.find((c) => c.ip === consoleInfo.ip)) {
            consoles.push(consoleInfo);
          }
        }
      } catch (_) {}
    });

    socket.bind(0, () => {
      try { socket.setBroadcast(true); } catch (_) {}
      const broadcasts = getBroadcastAddresses();
      for (const bcast of broadcasts) {
        try {
          socket.send(discoveryPayload, 0, discoveryPayload.length, XBOX_PORT, bcast);
        } catch (_) {}
      }
    });

    timer = setTimeout(() => {
      try { socket.close(); } catch (_) {}
      resolve({
        status: "success",
        found: consoles.length,
        consoles,
        message: consoles.length > 0
          ? `Found ${consoles.length} Xbox console(s).`
          : "No active Xbox consoles found on local network (make sure console is connected and in 'Instant-On / Sleep' mode).",
      });
    }, timeoutMs);
  });
}

/**
 * Send UDP 5050 wake packet burst to turn on Xbox
 */
function powerOn(ip, liveDeviceId, tries = 5) {
  return new Promise((resolve) => {
    const cleanId = (liveDeviceId || "").trim();
    if (!cleanId) {
      return resolve({
        status: "error",
        message: "Xbox Live Device ID is required to wake the console.",
      });
    }

    const idBuf = Buffer.from(cleanId, "utf8");
    const header = Buffer.from([0xdd, 0x02, 0x00, idBuf.length + 1]);
    const payload = Buffer.concat([header, idBuf, Buffer.from([0x00])]);

    const socket = dgram.createSocket("udp4");
    let count = 0;

    socket.on("error", (err) => {
      try { socket.close(); } catch (_) {}
      resolve({ status: "error", message: err.message });
    });

    const interval = setInterval(() => {
      try {
        socket.send(payload, 0, payload.length, XBOX_PORT, ip);
      } catch (_) {}
      count++;
      if (count >= tries) {
        clearInterval(interval);
        setTimeout(() => {
          try { socket.close(); } catch (_) {}
          resolve({
            status: "success",
            message: `Sent ${tries} instant wake packet(s) to ${ip} (Live ID: ${cleanId}). Console is waking up...`,
            target_ip: ip,
            live_device_id: cleanId,
          });
        }, 50);
      }
    }, 30);
  });
}

/**
 * Ping console on port 5050 to check online status
 */
function ping(ip, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const probe = Buffer.from("dd00000a000000000000000800000002", "hex");
    let responded = false;

    const timer = setTimeout(() => {
      if (!responded) {
        try { socket.close(); } catch (_) {}
        resolve({
          status: "offline_or_sleeping",
          ip,
          awake: false,
          message: `Console at ${ip} did not respond within ${timeoutMs}ms.`,
        });
      }
    }, timeoutMs);

    socket.on("message", (msg) => {
      if (msg.length >= 4 && msg[0] === 0xdd && msg[1] === 0x01) {
        responded = true;
        clearTimeout(timer);
        try { socket.close(); } catch (_) {}
        resolve({
          status: "online",
          ip,
          awake: true,
          message: `Xbox console at ${ip} is ONLINE and responding on port ${XBOX_PORT}.`,
        });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      resolve({ status: "error", ip, error: err.message });
    });

    socket.bind(0, () => {
      socket.send(probe, 0, probe.length, XBOX_PORT, ip);
    });
  });
}

/**
 * Establish a connected SmartGlass session with Channel Managers
 */
async function withSmartGlass(ip, callback, timeoutMs = 8000) {
  const Smartglass = require("xbox-smartglass-core-node");
  const SystemInput = require("xbox-smartglass-core-node/src/channels/systeminput");
  const SystemMedia = require("xbox-smartglass-core-node/src/channels/systemmedia");
  const TvRemote = require("xbox-smartglass-core-node/src/channels/tvremote");

  const cfg = loadConfig();
  const targetIp = ip || cfg.ip;
  if (!targetIp) {
    throw new Error("No Xbox IP address configured. Run discovery or pass 'ip'.");
  }

  const sg = Smartglass();
  const sysInput = SystemInput();
  const sysMedia = SystemMedia();
  const tvRemote = TvRemote();

  sg.addManager("system_input", sysInput);
  sg.addManager("system_media", sysMedia);
  sg.addManager("tv_remote", tvRemote);

  const uhs = cfg.user_hash || undefined;
  const token = cfg.xsts_token || undefined;

  const connectPromise = sg.connect(targetIp, uhs, token);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out connecting to Xbox at ${targetIp}. Ensure console is awake.`)), timeoutMs)
  );

  await Promise.race([connectPromise, timeoutPromise]);

  try {
    return await callback({ sg, sysInput, sysMedia, tvRemote, targetIp });
  } finally {
    try {
      setTimeout(() => {
        try { sg.disconnect(); } catch (_) {}
      }, 500);
    } catch (_) {}
  }
}

/**
 * Send controller gamepad button
 */
async function sendButton(buttonName, ip = null) {
  let mapped = (buttonName || "").toLowerCase().trim();
  if (mapped === "guide") mapped = "nexus";
  if (mapped === "select" || mapped === "back") mapped = "view";
  if (mapped === "start" || mapped === "options") mapped = "menu";

  const validButtons = ["a", "b", "x", "y", "up", "down", "left", "right", "nexus", "view", "menu"];
  if (!validButtons.includes(mapped)) {
    throw new Error(`Invalid button: '${buttonName}'. Valid options: ${validButtons.join(", ")}`);
  }

  return await withSmartGlass(ip, async ({ sysInput, targetIp }) => {
    for (let i = 0; i < 20; i++) {
      if (sysInput._channel_manager.getStatus()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const res = await sysInput.sendCommand(mapped);
    return { status: "success", action: "button_press", button: mapped, ip: targetIp, details: res };
  });
}

/**
 * Send media playback command
 */
async function sendMedia(command, ip = null) {
  let mapped = (command || "").toLowerCase().trim();
  if (mapped === "next") mapped = "next_track";
  if (mapped === "prev" || mapped === "previous") mapped = "prev_track";
  if (mapped === "ff" || mapped === "fastforward") mapped = "fast_forward";
  if (mapped === "rw") mapped = "rewind";

  return await withSmartGlass(ip, async ({ sysMedia, targetIp }) => {
    for (let i = 0; i < 20; i++) {
      if (sysMedia._channel_manager.getStatus()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const res = await sysMedia.sendCommand(mapped);
    return { status: "success", action: "media_command", command: mapped, ip: targetIp, details: res };
  });
}

/**
 * Send TV volume command via HDMI-CEC
 */
async function sendVolume(command, ip = null) {
  const norm = (command || "").toLowerCase().trim();
  let irCode = "btn.vol_up";
  if (norm.includes("down")) irCode = "btn.vol_down";
  if (norm.includes("mute")) irCode = "btn.vol_mute";

  return await withSmartGlass(ip, async ({ tvRemote, targetIp }) => {
    for (let i = 0; i < 20; i++) {
      if (tvRemote._channel_manager.getStatus()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const res = await tvRemote.sendIrCommand(irCode);
    return { status: "success", action: "volume_command", command: irCode, ip: targetIp, details: res };
  });
}

/**
 * Send local SmartGlass power off packet
 */
async function powerOffLocal(ip = null) {
  return await withSmartGlass(ip, async ({ sg, targetIp }) => {
    await new Promise((r) => setTimeout(r, 400));
    await sg.powerOff();
    return { status: "success", action: "power_off", ip: targetIp };
  });
}

/**
 * Record last 30-60 seconds gameplay clip
 */
async function recordDvr(ip = null) {
  return await withSmartGlass(ip, async ({ sg, targetIp }) => {
    await new Promise((r) => setTimeout(r, 400));
    await sg.recordGameDvr();
    return { status: "success", action: "record_dvr", ip: targetIp };
  });
}

module.exports = {
  discover,
  powerOn,
  ping,
  sendButton,
  sendMedia,
  sendVolume,
  powerOffLocal,
  recordDvr,
  withSmartGlass,
};
