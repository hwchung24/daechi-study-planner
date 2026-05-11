const { getParentPhoneByUserId } = require("./db");
const {
  isSolapiConfigured,
  normalizeKoreanPhone,
  sendKakaoAlimtalk
} = require("./solapiService");

const NOTIFICATION_ACTION_PREFIX = "[[DAECHI_ACTION]]";

function extractVisibleNotificationBody(body) {
  const raw = String(body || "").trim();
  if (!raw.startsWith(NOTIFICATION_ACTION_PREFIX)) {
    return raw;
  }
  const divider = raw.indexOf("\n\n");
  return divider >= 0 ? raw.slice(divider + 2).trim() : "";
}

function buildKakaoNotificationText(title, body) {
  return [String(title || "").trim(), String(extractVisibleNotificationBody(body) || "").trim()]
    .filter(Boolean)
    .join("\n");
}

function isParentKakaoOutboundEnabled() {
  const v = String(process.env.SOLAPI_ENABLE_PARENT_KAKAO_NOTIFICATIONS || "")
    .trim()
    .toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

/**
 * 학부모 인앱 알림과 동일한 제목·본문으로 카카오 알림톡 발송.
 * parents.phone 이 있고 Solapi 카카오 설정이 되어 있을 때만 전송.
 */
async function sendParentKakaoIfEnabled(parentUserId, title, body) {
  if (!isParentKakaoOutboundEnabled()) {
    return { sent: false, reason: "disabled" };
  }
  if (!isSolapiConfigured()) {
    return { sent: false, reason: "not_configured" };
  }
  const uid = Number(parentUserId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { sent: false, reason: "bad_user" };
  }
  const rawPhone = await getParentPhoneByUserId(uid).catch(() => null);
  if (!rawPhone) {
    return { sent: false, reason: "no_phone" };
  }
  const phone = normalizeKoreanPhone(rawPhone);
  if (!phone) {
    return { sent: false, reason: "invalid_phone" };
  }
  const text = buildKakaoNotificationText(title, body);
  if (!text) {
    return { sent: false, reason: "empty" };
  }
  await sendKakaoAlimtalk({ to: phone, text });
  return { sent: true };
}

module.exports = {
  sendParentKakaoIfEnabled,
  buildKakaoNotificationText,
  extractVisibleNotificationBody
};
