/**
 * Microsoft OAuth Device-Code Flow & Xbox Live Token Exchange
 * Bypasses 2FA smoothly without exposing passwords via official https://www.microsoft.com/link
 */

const https = require("https");
const querystring = require("querystring");
const { URL } = require("url");
const { loadConfig, saveConfig, loadTokens, saveTokens } = require("./config");

const XBOX_CLIENT_ID = "a34ac209-edab-4b08-91e7-a4558d8da1bd";
const XBOX_SCOPES = "XboxLive.signin XboxLive.offline_access";

function httpPost(urlStr, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = typeof data === "string" ? data : JSON.stringify(data);
    const defaultHeaders = typeof data === "string"
      ? { "Content-Type": "application/x-www-form-urlencoded" }
      : { "Content-Type": "application/json" };

    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        ...defaultHeaders,
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
      timeout: 10000,
    }, (res) => {
      let resp = "";
      res.on("data", (chunk) => (resp += chunk));
      res.on("end", () => {
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
      reject(new Error("Request timed out"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Request an official Microsoft Device Code for 2FA-safe login
 */
async function requestDeviceCode() {
  const postData = querystring.stringify({
    client_id: XBOX_CLIENT_ID,
    scope: XBOX_SCOPES,
  });

  const res = await httpPost("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode", postData);
  if (res.data && res.data.user_code) {
    return {
      status: "pending_user_approval",
      user_code: res.data.user_code,
      verification_uri: res.data.verification_uri || "https://www.microsoft.com/link",
      device_code: res.data.device_code,
      expires_in: res.data.expires_in || 900,
      interval: res.data.interval || 5,
      message: `Open ${res.data.verification_uri || "https://www.microsoft.com/link"} in your browser and enter code: ${res.data.user_code}`,
    };
  }
  throw new Error(`Failed to request device code: ${JSON.stringify(res.data || res.raw)}`);
}

/**
 * Poll Microsoft OAuth token endpoint until user approves the code
 */
function pollForToken(deviceCode, intervalSec = 5, timeoutSec = 900) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const intervalMs = intervalSec * 1000;

    async function check() {
      if (Date.now() - startTime > timeoutSec * 1000) {
        return reject(new Error("Device code authentication timed out. Please request a new code."));
      }

      const postData = querystring.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XBOX_CLIENT_ID,
        device_code: deviceCode,
      });

      try {
        const res = await httpPost("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", postData);
        if (res.data && res.data.access_token) {
          saveTokens(res.data);
          const xboxAuth = await exchangeForXboxTokens(res.data.access_token);
          return resolve(xboxAuth);
        } else if (res.data && res.data.error === "authorization_pending") {
          setTimeout(check, intervalMs);
        } else if (res.data && res.data.error === "slow_down") {
          setTimeout(check, intervalMs + 2000);
        } else {
          setTimeout(check, intervalMs);
        }
      } catch (_) {
        setTimeout(check, intervalMs);
      }
    }

    setTimeout(check, intervalMs);
  });
}

/**
 * Exchange Microsoft OAuth access token for Xbox Live User Token and XSTS Token
 */
async function exchangeForXboxTokens(accessToken) {
  // Step 1: Exchange for Xbox Live User Token
  const userTokenRes = await httpPost("https://user.auth.xboxlive.com/user/authenticate", {
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: "d=" + accessToken,
    },
  }, { "x-xbl-contract-version": "1" });

  if (!userTokenRes.data || !userTokenRes.data.Token) {
    throw new Error(`Xbox User Token exchange failed: ${JSON.stringify(userTokenRes.data || userTokenRes.raw)}`);
  }

  const userToken = userTokenRes.data.Token;
  const uhs = userTokenRes.data.DisplayClaims?.xui?.[0]?.uhs;

  // Step 2: Exchange for XSTS Token
  const xstsRes = await httpPost("https://xsts.auth.xboxlive.com/xsts/authorize", {
    RelyingParty: "http://xboxlive.com",
    TokenType: "JWT",
    Properties: {
      UserTokens: [userToken],
      SandboxId: "RETAIL",
    },
  }, { "x-xbl-contract-version": "1" });

  if (!xstsRes.data || !xstsRes.data.Token) {
    throw new Error(`XSTS Token exchange failed: ${JSON.stringify(xstsRes.data || xstsRes.raw)}`);
  }

  const xstsToken = xstsRes.data.Token;
  const xuid = xstsRes.data.DisplayClaims?.xui?.[0]?.xid || "";

  const cfg = loadConfig();
  cfg.user_hash = uhs;
  cfg.xsts_token = xstsToken;
  if (xuid) cfg.xuid = xuid;
  saveConfig(cfg);

  return {
    status: "authenticated",
    user_hash: uhs,
    xuid,
    expires_on: xstsRes.data.NotAfter,
    message: "Successfully authenticated with Xbox Live!",
  };
}

module.exports = {
  requestDeviceCode,
  pollForToken,
  exchangeForXboxTokens,
};
