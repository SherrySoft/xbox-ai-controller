/**
 * Microsoft Console Command Service (XCCS) Cloud Client
 * Official 1-click launching and cloud remote control
 */

const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const { loadConfig, saveConfig, saveInstalledApps, loadInstalledApps } = require("./config");

function getXccsHeaders(cfg) {
  return {
    Authorization: `XBL3.0 x=${cfg.user_hash};${cfg.xsts_token}`,
    "Accept-Language": "en-US",
    "x-xbl-contract-version": "4",
    "x-xbl-client-name": "XboxApp",
    "x-xbl-client-type": "UWA",
    "x-xbl-client-version": "39.39.22001.0",
    skillplatform: "RemoteManagement",
    "Content-Type": "application/json",
  };
}

async function requestXccs(method, path, data = null, cfg = null, isRetry = false) {
  let activeCfg = cfg || loadConfig();
  if (!activeCfg.user_hash || !activeCfg.xsts_token) {
    throw new Error("Xbox Live authentication required. Run 'xbox_login' or 'request_device_code' first.");
  }

  return new Promise((resolve, reject) => {
    const headers = getXccsHeaders(activeCfg);
    let body = null;
    if (data) {
      body = JSON.stringify(data);
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const req = https.request({
      hostname: "xccs.xboxlive.com",
      port: 443,
      path,
      method,
      headers,
      timeout: 10000,
    }, (res) => {
      let resp = "";
      res.on("data", (chunk) => (resp += chunk));
      res.on("end", async () => {
        if (res.statusCode === 401 && !isRetry) {
          try {
            const { refreshXboxTokens } = require("./auth");
            await refreshXboxTokens();
            const retryRes = await requestXccs(method, path, data, null, true);
            return resolve(retryRes);
          } catch (_) {}
        }
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resp) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: resp });
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("XCCS request timed out"));
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * List all consoles registered under this Xbox Live account
 */
async function getDeviceList(cfg = null) {
  const res = await requestXccs("GET", "/lists/devices", null, cfg);
  if (res.status === 200 && res.data && res.data.result) {
    const activeCfg = cfg || loadConfig();
    const primary = res.data.result[0];
    if (primary && primary.id) {
      activeCfg.live_device_id = primary.id;
      if (primary.name) activeCfg.name = primary.name;
      saveConfig(activeCfg);
    }
    return {
      status: "success",
      count: res.data.result.length,
      devices: res.data.result,
    };
  }
  return res;
}

/**
 * Fetch list of installed games and apps directly from the console
 */
async function fetchInstalledApps(cfg = null, deviceId = null) {
  const activeCfg = cfg || loadConfig();
  const targetId = deviceId || activeCfg.live_device_id;
  if (!targetId) {
    try {
      await getDeviceList(activeCfg);
    } catch (_) {}
  }

  const finalId = targetId || activeCfg.live_device_id;
  try {
    const res = await requestXccs("GET", `/lists/installedApps?deviceId=${finalId}`, null, activeCfg);
    if (res.status === 200 && res.data && res.data.result) {
      saveInstalledApps(res.data.result);
      return {
        status: "success",
        count: res.data.result.length,
        apps: res.data.result,
        source: "live_console",
      };
    }
  } catch (_) {}

  // Fallback to locally cached installed apps
  const cached = loadInstalledApps();
  if (cached && cached.length > 0) {
    return {
      status: "success",
      count: cached.length,
      apps: cached,
      source: "local_cache",
    };
  }

  return { status: "no_apps_found", count: 0, apps: [] };
}

/**
 * 1-Click Launch a game or app by its Product ID
 */
async function launchByProductId(productId, cfg = null, deviceId = null) {
  const activeCfg = cfg || loadConfig();
  const targetId = deviceId || activeCfg.live_device_id;

  const payload = {
    destination: "Xbox",
    type: "Shell",
    command: "ActivateApplicationWithOneStoreProductId",
    sessionId: crypto.randomUUID(),
    sourceId: "com.microsoft.smartglass",
    parameters: [{ oneStoreProductId: productId }],
    linkedXboxId: targetId,
  };

  const res = await requestXccs("POST", "/commands", payload, activeCfg);
  if (res.status === 200) {
    return {
      status: "success",
      action: "launch",
      product_id: productId,
      console: res.data?.destination?.name || targetId,
    };
  }
  throw new Error(`XCCS Launch Failed (${res.status}): ${JSON.stringify(res.data || res.raw)}`);
}

/**
 * Return console to Home Dashboard
 */
async function goHome(cfg = null, deviceId = null) {
  const activeCfg = cfg || loadConfig();
  const targetId = deviceId || activeCfg.live_device_id;

  const payload = {
    destination: "Xbox",
    type: "Shell",
    command: "GoHome",
    sessionId: crypto.randomUUID(),
    sourceId: "com.microsoft.smartglass",
    parameters: [],
    linkedXboxId: targetId,
  };

  const res = await requestXccs("POST", "/commands", payload, activeCfg);
  return { status: "success", action: "go_home", response: res.data };
}

/**
 * Power off console via XCCS
 */
async function powerOffCloud(cfg = null, deviceId = null) {
  const activeCfg = cfg || loadConfig();
  const targetId = deviceId || activeCfg.live_device_id;

  const payload = {
    destination: "Xbox",
    type: "Power",
    command: "TurnOff",
    sessionId: crypto.randomUUID(),
    sourceId: "com.microsoft.smartglass",
    parameters: [],
    linkedXboxId: targetId,
  };

  const res = await requestXccs("POST", "/commands", payload, activeCfg);
  return { status: "success", action: "power_off", response: res.data };
}

/**
 * Instant Wake Up console via Microsoft XCCS Cloud
 */
async function wakeCloud(cfg = null, deviceId = null) {
  const activeCfg = cfg || loadConfig();
  const targetId = deviceId || activeCfg.live_device_id;

  const payload = {
    destination: "Xbox",
    type: "Power",
    command: "WakeUp",
    sessionId: crypto.randomUUID(),
    sourceId: "com.microsoft.smartglass",
    parameters: [],
    linkedXboxId: targetId,
  };

  const res = await requestXccs("POST", "/commands", payload, activeCfg);
  return { status: "success", action: "wake_up", method: "xccs_cloud", response: res.data };
}

module.exports = {
  requestXccs,
  getDeviceList,
  fetchInstalledApps,
  launchByProductId,
  goHome,
  powerOffCloud,
  wakeCloud,
};
