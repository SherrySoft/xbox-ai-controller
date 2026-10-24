/**
 * Interactive One-Click MCP Installer for AI Agents
 * Automatically configures Antigravity, Claude Desktop, Cursor, and Windsurf
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const AGENTS = {
  antigravity: {
    id: "antigravity",
    name: "Antigravity CLI (agy)",
    getPath: () => path.join(os.homedir(), ".gemini", "config", "mcp_config.json"),
  },
  claude: {
    id: "claude",
    name: "Claude Desktop",
    getPath: () => {
      if (process.platform === "win32") {
        return path.join(
          process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
          "Claude",
          "claude_desktop_config.json"
        );
      } else if (process.platform === "darwin") {
        return path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json"
        );
      } else {
        return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
      }
    },
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    getPath: () => path.join(os.homedir(), ".cursor", "mcp.json"),
  },
  windsurf: {
    id: "windsurf",
    name: "Windsurf",
    getPath: () => path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"),
  },
};

/**
 * Installs Xbox MCP configuration into target AI agent config file
 */
function installToAgent(agentKey, useNpx = true) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);

  const filePath = agent.getPath();
  const dirPath = path.dirname(filePath);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  let config = {};
  if (fs.existsSync(filePath)) {
    try {
      config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_) {
      config = {};
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  if (useNpx) {
    config.mcpServers.xbox = {
      command: "npx",
      args: ["-y", "xbox-ai-controller"],
    };
  } else {
    config.mcpServers.xbox = {
      command: "node",
      args: [path.resolve(__dirname, "server.js")],
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  return { success: true, name: agent.name, path: filePath };
}

/**
 * Interactive prompt helper
 */
function askQuestion(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * Runs interactive setup installer in terminal
 */
async function runInstallerInteractive(defaultAgent = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`
╔════════════════════════════════════════════════════════════╗
║         🎮 Xbox AI Controller - Auto MCP Installer         ║
╚════════════════════════════════════════════════════════════╝
`);

  try {
    let chosenAgents = [];

    if (defaultAgent === "all") {
      chosenAgents = ["antigravity", "claude", "cursor", "windsurf"];
    } else if (defaultAgent && AGENTS[defaultAgent]) {
      chosenAgents = [defaultAgent];
    } else {
      console.log("Which AI Agent would you like to configure?\n");
      console.log("  [1] Antigravity CLI (agy)");
      console.log("  [2] Claude Desktop");
      console.log("  [3] Cursor");
      console.log("  [4] Windsurf");
      console.log("  [5] All of the above\n");

      const answer = (await askQuestion(rl, "Select an option (1-5) [default: 5]: ")).trim() || "5";

      switch (answer) {
        case "1":
          chosenAgents = ["antigravity"];
          break;
        case "2":
          chosenAgents = ["claude"];
          break;
        case "3":
          chosenAgents = ["cursor"];
          break;
        case "4":
          chosenAgents = ["windsurf"];
          break;
        case "5":
        default:
          chosenAgents = ["antigravity", "claude", "cursor", "windsurf"];
          break;
      }
    }

    console.log("\nChoose Runner Type:\n");
    console.log("  [1] npx (Zero-install, always latest from npm) [Recommended]");
    console.log("  [2] Local path (Direct from this repository)\n");

    const runnerChoice = (await askQuestion(rl, "Select runner (1-2) [default: 1]: ")).trim() || "1";
    const useNpx = runnerChoice !== "2";

    console.log("\n⚙️ Configuring agents...");
    for (const key of chosenAgents) {
      try {
        const res = installToAgent(key, useNpx);
        console.log(`  ✅ Configured ${res.name} -> ${res.path}`);
      } catch (err) {
        console.error(`  ❌ Failed configuring ${key}: ${err.message}`);
      }
    }

    console.log(`
🎉 Done! Restart your AI agent and you can now ask:
  👉 "Turn on my Xbox"
  👉 "Open EA Sports FC 25"
  👉 "Launch Minecraft"
  👉 "Press the Xbox Guide button"
`);
  } finally {
    rl.close();
  }
}

module.exports = {
  AGENTS,
  installToAgent,
  runInstallerInteractive,
};
