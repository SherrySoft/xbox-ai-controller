/**
 * Configuration & Credentials Manager
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_DIR = process.env.XBOX_CONFIG_DIR || path.join(os.homedir(), ".xbox-mcp");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const APPS_FILE = path.join(CONFIG_DIR, "installed_apps.json");
const TOKENS_FILE = path.join(CONFIG_DIR, "ms_token.json");

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (_) {}
  return {
    ip: "",
    live_device_id: "",
    name: "Xbox One",
    user_hash: "",
    xsts_token: "",
    xuid: "",
    openxbl_api_key: "",
  };
}

function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

function loadInstalledApps() {
  ensureConfigDir();
  try {
    if (fs.existsSync(APPS_FILE)) {
      return JSON.parse(fs.readFileSync(APPS_FILE, "utf8"));
    }
  } catch (_) {}
  return [];
}

function saveInstalledApps(apps) {
  ensureConfigDir();
  fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), "utf8");
  return apps;
}

function loadTokens() {
  ensureConfigDir();
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    }
  } catch (_) {}
  return null;
}

function saveTokens(tokens) {
  ensureConfigDir();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf8");
  return tokens;
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  APPS_FILE,
  TOKENS_FILE,
  ensureConfigDir,
  loadConfig,
  saveConfig,
  loadInstalledApps,
  saveInstalledApps,
  loadTokens,
  saveTokens,
};
