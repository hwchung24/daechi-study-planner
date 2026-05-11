const crypto = require("crypto");

const SOLAPI_API_BASE = "https://api.solapi.com";
const SOLAPI_API_KEY = String(process.env.SOLAPI_API_KEY || "").trim();
const SOLAPI_API_SECRET = String(process.env.SOLAPI_API_SECRET || "").trim();
const SOLAPI_SENDER = String(process.env.SOLAPI_SENDER || "").trim();
const SOLAPI_KAKAO_PFID = String(process.env.SOLAPI_KAKAO_PFID || "").trim();
const SOLAPI_KAKAO_TEMPLATE_ID = String(process.env.SOLAPI_KAKAO_TEMPLATE_ID || "").trim();

function isSolapiConfigured() {
  return Boolean(SOLAPI_API_KEY && SOLAPI_API_SECRET && SOLAPI_SENDER && SOLAPI_KAKAO_PFID);
}

function isSolapiSmsConfigured() {
  return Boolean(SOLAPI_API_KEY && SOLAPI_API_SECRET && SOLAPI_SENDER);
}

function normalizeKoreanPhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("82") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

function buildSolapiAuthHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", SOLAPI_API_SECRET)
    .update(`${date}${salt}`)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function solapiRequest(path, body) {
  const res = await fetch(`${SOLAPI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildSolapiAuthHeader()
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(json?.message || json?.errorMessage || "solapi_request_failed").trim();
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function sendKakaoAlimtalk({
  to,
  text,
  subject = "",
  templateId = SOLAPI_KAKAO_TEMPLATE_ID,
  pfId = SOLAPI_KAKAO_PFID,
  disableSms = true
}) {
  if (!isSolapiConfigured()) {
    throw new Error("SOLAPI_NOT_CONFIGURED");
  }
  const toPhone = normalizeKoreanPhone(to);
  if (!toPhone) throw new Error("SOLAPI_INVALID_RECIPIENT");
  if (!templateId) throw new Error("SOLAPI_TEMPLATE_ID_REQUIRED");
  const payload = {
    message: {
      to: toPhone,
      from: SOLAPI_SENDER,
      text: String(text || "").trim(),
      ...(subject ? { subject: String(subject).trim() } : {}),
      kakaoOptions: {
        pfId,
        templateId,
        disableSms: Boolean(disableSms)
      }
    }
  };
  return solapiRequest("/messages/v4/send", payload);
}

async function sendSolapiSms({ to, text, subject = "" }) {
  if (!isSolapiSmsConfigured()) {
    throw new Error("SOLAPI_SMS_NOT_CONFIGURED");
  }
  const toPhone = normalizeKoreanPhone(to);
  if (!toPhone) throw new Error("SOLAPI_INVALID_RECIPIENT");
  const payload = {
    message: {
      to: toPhone,
      from: SOLAPI_SENDER,
      text: String(text || "").trim(),
      ...(subject ? { subject: String(subject).trim() } : {})
    }
  };
  return solapiRequest("/messages/v4/send", payload);
}

module.exports = {
  isSolapiConfigured,
  isSolapiSmsConfigured,
  normalizeKoreanPhone,
  sendKakaoAlimtalk,
  sendSolapiSms
};
