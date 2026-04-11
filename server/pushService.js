const path = require("path");
const http2 = require("http2");
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  listActiveUserPushTokens,
  markUserPushTokenSent,
  markUserPushTokenError
} = require("./db");

const APNS_KEY_ID = String(process.env.APNS_KEY_ID || "").trim();
const APNS_TEAM_ID = String(process.env.APNS_TEAM_ID || "").trim();
const APNS_BUNDLE_ID = String(process.env.APNS_BUNDLE_ID || "").trim();
const APNS_PRIVATE_KEY = String(process.env.APNS_PRIVATE_KEY || "")
  .replace(/\\n/g, "\n")
  .trim();
const APNS_USE_SANDBOX = String(process.env.APNS_USE_SANDBOX || "false").trim() === "true";

let cachedProviderToken = "";
let cachedProviderTokenExpiresAt = 0;

function isApnsConfigured() {
  return Boolean(APNS_KEY_ID && APNS_TEAM_ID && APNS_BUNDLE_ID && APNS_PRIVATE_KEY);
}

function currentApnsOrigin() {
  return APNS_USE_SANDBOX
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

function getProviderToken() {
  if (cachedProviderToken && Date.now() < cachedProviderTokenExpiresAt - 60_000) {
    return cachedProviderToken;
  }
  cachedProviderToken = jwt.sign(
    {},
    APNS_PRIVATE_KEY,
    {
      algorithm: "ES256",
      issuer: APNS_TEAM_ID,
      expiresIn: "50m",
      header: {
        alg: "ES256",
        kid: APNS_KEY_ID
      }
    }
  );
  cachedProviderTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedProviderToken;
}

function sendApnsRequest(deviceToken, payload) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(currentApnsOrigin());

    client.on("error", error => {
      client.close();
      reject(error);
    });

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${getProviderToken()}`,
      "apns-topic": APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json"
    });

    let responseBody = "";
    let statusCode = 0;

    request.setEncoding("utf8");
    request.on("response", headers => {
      statusCode = Number(headers[http2.constants.HTTP2_HEADER_STATUS] || 0);
    });
    request.on("data", chunk => {
      responseBody += chunk;
    });
    request.on("end", () => {
      client.close();
      resolve({ statusCode, body: responseBody });
    });
    request.on("error", error => {
      client.close();
      reject(error);
    });

    request.end(JSON.stringify(payload));
  });
}

function buildAlertPayload(input = {}) {
  const title = String(input.title || "").trim();
  const body = String(input.body || "").trim();
  const data = input.data && typeof input.data === "object" ? input.data : {};
  return {
    aps: {
      alert: {
        title,
        body
      },
      sound: "default",
      badge: 1
    },
    data
  };
}

async function sendPushToUser(userId, input = {}) {
  if (!isApnsConfigured()) {
    return { ok: false, skipped: true, reason: "apns_not_configured" };
  }

  const tokens = await listActiveUserPushTokens(userId, "ios");
  if (!tokens.length) {
    return { ok: false, skipped: true, reason: "no_active_tokens" };
  }

  const payload = buildAlertPayload(input);
  let ok = 0;
  let fail = 0;

  for (const token of tokens) {
    try {
      const response = await sendApnsRequest(String(token.device_token || ""), payload);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        ok += 1;
        await markUserPushTokenSent(Number(token.id));
        continue;
      }

      fail += 1;
      let reason = `apns_${response.statusCode}`;
      try {
        const parsed = JSON.parse(String(response.body || "{}"));
        if (parsed?.reason) {
          reason = String(parsed.reason);
        }
      } catch {
        // ignore malformed APNs body
      }
      await markUserPushTokenError(
        Number(token.id),
        reason,
        reason === "BadDeviceToken" || reason === "Unregistered" || response.statusCode === 410
      );
    } catch (error) {
      fail += 1;
      await markUserPushTokenError(
        Number(token.id),
        error instanceof Error && error.message ? error.message : "apns_send_failed"
      );
    }
  }

  return { ok: ok > 0, sent: ok, failed: fail };
}

async function sendPushToUsers(userIds, input = {}) {
  const uniqueUserIds = Array.from(new Set((Array.isArray(userIds) ? userIds : []).map(Number))).filter(
    value => Number.isFinite(value) && value > 0
  );
  const results = [];
  for (const userId of uniqueUserIds) {
    results.push({ userId, ...(await sendPushToUser(userId, input)) });
  }
  return results;
}

module.exports = {
  isApnsConfigured,
  sendPushToUser,
  sendPushToUsers
};