function buildWebLockPayload({
  webAppUrl,
  parentUserId,
  studentUserId,
  lockTime,
  serial,
  locked
}) {
  const baseUrl = String(webAppUrl || "").replace(/\/+$/, "");
  const entryUrl = serial
    ? `${baseUrl}/webclip/entry?serial=${encodeURIComponent(serial)}&next=/`
    : `${baseUrl}/#/`;

  return {
    channel: "webview",
    locked: Boolean(locked),
    entryUrl,
    hint: locked
      ? "Web Clip 또는 웹 앱 진입 시 잠금 화면을 우선 표시합니다."
      : "웹 진입 제한을 해제합니다.",
    rule: {
      parentUserId,
      studentUserId,
      lockTime
    }
  };
}

async function applyWebLockStrategy(context) {
  return buildWebLockPayload({ ...context, locked: true });
}

async function clearWebLockStrategy(context) {
  return buildWebLockPayload({ ...context, locked: false });
}

module.exports = {
  applyWebLockStrategy,
  clearWebLockStrategy
};
