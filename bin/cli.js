#!/usr/bin/env node
/**
 * Xbox AI Controller - Command Line Interface (CLI)
 */

const { discover, powerOn, ping, sendButton, sendMedia, sendVolume, powerOffLocal, recordDvr } = require("../src/smartglass");
const { getDeviceList, fetchInstalledApps, launchByProductId, goHome, powerOffCloud, wakeCloud } = require("../src/xccs");
const { requestDeviceCode, pollForToken } = require("../src/auth");
const { resolveAppOrGame, POPULAR_APPS } = require("../src/database");
const { loadConfig, saveConfig } = require("../src/config");

const args = process.argv.slice(2);
const command = (args[0] || "help").toLowerCase();

async function main() {
  const cfg = loadConfig();

  switch (command) {
    case "server":
    case "mcp": {
      require("../src/server");
      break;
    }

    case "discover":
    case "scan": {
      console.log("🔍 Scanning local network for Xbox One & Xbox Series consoles...");
      const res = await discover(4000);
      if (res.consoles && res.consoles.length > 0) {
        console.log(`✅ Found ${res.consoles.length} console(s):`);
        res.consoles.forEach((c, idx) => {
          console.log(`  [${idx + 1}] ${c.name} - IP: ${c.ip} (Live ID: ${c.live_device_id || "N/A"})`);
        });
        const first = res.consoles[0];
        cfg.ip = first.ip;
        if (first.live_device_id) cfg.live_device_id = first.live_device_id;
        if (first.name) cfg.name = first.name;
        saveConfig(cfg);
        console.log(`💾 Automatically saved ${first.name} (${first.ip}) to config.`);
      } else {
        console.log("❌ No Xbox consoles found. Ensure the console is connected to the same Wi-Fi/LAN and Sleep mode is active.");
      }
      break;
    }

    case "wake":
    case "poweron":
    case "on": {
      const ip = args[1] || cfg.ip;
      const liveId = args[2] || cfg.live_device_id;
      if (!ip && !liveId) {
        console.error("❌ Target IP or Live Device ID missing. Run 'xbox-ai discover' first.");
        process.exit(1);
      }
      console.log(`⚡ Sending instant dual wake (Fast-UDP + Microsoft XCCS Cloud) to ${ip || liveId}...`);
      const tasks = [];
      if (ip && liveId) tasks.push(powerOn(ip, liveId, 6));
      if (cfg.user_hash && cfg.xsts_token) {
        tasks.push(wakeCloud(cfg, liveId).catch((err) => ({ error: err.message })));
      }
      await Promise.allSettled(tasks);
      console.log(`✅ Instant wake signal dispatched to ${ip} (${liveId}).`);
      break;
    }

    case "off":
    case "sleep":
    case "poweroff": {
      console.log("🌙 Putting console into sleep mode...");
      if (cfg.user_hash && cfg.xsts_token) {
        try {
          const res = await powerOffCloud(cfg);
          console.log("✅ Cloud power-off dispatched successfully!");
          return;
        } catch (_) {}
      }
      const res = await powerOffLocal(args[1] || cfg.ip);
      console.log("✅ SmartGlass local power-off dispatched successfully!");
      break;
    }

    case "ping": {
      const ip = args[1] || cfg.ip;
      if (!ip) {
        console.error("❌ No IP configured. Run 'xbox-ai discover' first.");
        process.exit(1);
      }
      console.log(`📡 Pinging ${ip} on port 5050...`);
      const res = await ping(ip);
      console.log(res.awake ? `🟢 ${res.message}` : `🔴 ${res.message}`);
      break;
    }

    case "launch":
    case "open":
    case "play": {
      const target = args.slice(1).join(" ");
      if (!target) {
        console.error("❌ Please specify a game or app to launch. Example: xbox-ai launch 'FC 25'");
        process.exit(1);
      }

      if (target.toLowerCase() === "home" || target.toLowerCase() === "dashboard") {
        console.log("🏠 Returning to Home Dashboard...");
        if (cfg.user_hash && cfg.xsts_token) {
          try {
            await goHome(cfg);
            console.log("✅ Returned to Home dashboard.");
            return;
          } catch (_) {}
        }
        await sendButton("nexus", args[1] || cfg.ip);
        return;
      }

      const resolved = resolveAppOrGame(target);
      console.log(`🚀 Launching '${resolved.name}' (Product ID: ${resolved.productId})...`);

      if (cfg.user_hash && cfg.xsts_token) {
        try {
          await launchByProductId(resolved.productId, cfg);
          console.log(`🎮 Game launched successfully on ${cfg.name || "Xbox"}!`);
          return;
        } catch (err) {
          console.error("❌ Cloud launch failed:", err.message);
        }
      } else {
        console.log("⚠️ Xbox Live authentication is required for direct launching.");
        console.log("Run 'xbox-ai login' to link your Microsoft account.");
      }
      break;
    }

    case "apps":
    case "games":
    case "installed": {
      console.log("📦 Fetching installed titles from console...");
      const res = await fetchInstalledApps(cfg);
      if (res.apps && res.apps.length > 0) {
        console.log(`✅ Found ${res.apps.length} installed games/apps:`);
        res.apps.forEach((a) => {
          console.log(`  - ${a.name} (ID: ${a.oneStoreProductId})`);
        });
      } else {
        console.log("No apps returned or authentication needed.");
      }
      break;
    }

    case "button":
    case "press": {
      const btn = args[1];
      if (!btn) {
        console.error("❌ Specify button: a, b, x, y, up, down, left, right, nexus, menu, view");
        process.exit(1);
      }
      console.log(`🎮 Sending button press: ${btn}...`);
      await sendButton(btn, args[2] || cfg.ip);
      console.log(`✅ Button '${btn}' pressed.`);
      break;
    }

    case "media": {
      const action = args[1] || "playpause";
      console.log(`🎬 Sending media command: ${action}...`);
      await sendMedia(action, args[2] || cfg.ip);
      console.log(`✅ Media command '${action}' sent.`);
      break;
    }

    case "vol":
    case "volume": {
      const action = args[1] || "volume_up";
      console.log(`🔊 Sending volume command: ${action}...`);
      await sendVolume(action, args[2] || cfg.ip);
      console.log(`✅ Volume command '${action}' sent.`);
      break;
    }

    case "dvr":
    case "record": {
      console.log("🎥 Recording recent gameplay clip ('Record that!')...");
      await recordDvr(args[1] || cfg.ip);
      console.log("✅ Recorded gameplay clip.");
      break;
    }

    case "login":
    case "auth": {
      console.log("🔐 Starting Microsoft Device-Code login...");
      const req = await requestDeviceCode();
      console.log("\n=======================================================");
      console.log(`👉 Open: ${req.verification_uri}`);
      console.log(`👉 Code: ${req.user_code}`);
      console.log("=======================================================\n");
      console.log("Waiting for browser confirmation...");
      const authResult = await pollForToken(req.device_code, req.interval, req.expires_in);
      console.log(`\n🎉 Success! Authenticated as XUID: ${authResult.xuid}`);
      break;
    }

    case "status":
    case "config": {
      console.log("📋 Current Xbox AI Controller Configuration:");
      console.log(JSON.stringify(cfg, null, 2));
      break;
    }

    case "help":
    default: {
      console.log(`
🎮 Xbox AI Controller CLI & MCP Server

Usage:
  xbox-ai <command> [options]

Commands:
  discover                  Scan Wi-Fi/LAN for Xbox One and Series consoles
  wake                      Send magic wake packet to power on console
  off                       Turn off console or enter standby
  ping                      Check if console is awake and responding
  launch <game/app>         1-Click launch (e.g. 'FC 25', 'Minecraft', 'YouTube')
  apps                      List all installed games and apps on console
  button <btn>              Press controller button (a, b, x, y, nexus, menu, dpad)
  media <action>            Media controls (play, pause, next, prev)
  volume <up|down|mute>     Control TV volume via HDMI-CEC
  dvr                       Record that! (Save last 30s game clip)
  login                     2FA-safe Microsoft Device-Code login
  status                    View current config and connection status
  mcp / server              Start Model Context Protocol (MCP) server for AI agents

Examples:
  xbox-ai discover
  xbox-ai wake
  xbox-ai launch "FC 25"
  xbox-ai launch Minecraft
  xbox-ai button nexus
  xbox-ai off
`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
