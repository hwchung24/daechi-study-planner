/**
 * 코치 학부모가 저장한 허용앱 모드 시간표(요일·시작·종료)와 서울 현재 시각을 맞춥니다.
 * UI의 DAY_LABELS: 월=0 … 일=6.
 */

const SEOUL_TZ = "Asia/Seoul";

const MODE_PRIORITY = { block: 3, utility: 2, free: 1 };

function parseHHmm(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function seoulMondayZeroWeekdayIndex(date = new Date()) {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TZ,
    weekday: "short"
  }).format(date);
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[short] ?? 0;
}

function seoulMinutesSinceMidnight(date = new Date()) {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: SEOUL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  const [h, min] = hm.split(":").map(Number);
  return h * 60 + min;
}

/**
 * @param {object} slot — { days: boolean[7], start, end, mode }
 * @returns {boolean}
 */
function slotMatchesNow(slot, now = new Date()) {
  if (!slot || typeof slot !== "object") return false;
  const days = Array.isArray(slot.days) && slot.days.length === 7
    ? slot.days.map(Boolean)
    : [false, false, false, false, false, false, false];
  const startM = parseHHmm(slot.start);
  const endM = parseHHmm(slot.end);
  if (startM == null || endM == null) return false;
  const overnight = endM <= startM;
  const d = seoulMondayZeroWeekdayIndex(now);
  const mins = seoulMinutesSinceMidnight(now);

  if (!overnight) {
    if (!days[d]) return false;
    return mins >= startM && mins < endM;
  }
  if (days[d] && mins >= startM) return true;
  const prev = (d + 6) % 7;
  if (days[prev] && mins < endM) return true;
  return false;
}

/**
 * @param {Array<object>} slots
 * @param {Date} [now]
 * @returns {"utility"|"free"|"block"|null} null → 기준(주간 동기화 또는 default 이름 프로파일)으로 돌림
 */
function computeDesiredNamedMode(slots, now = new Date()) {
  const allowed = new Set(["utility", "free", "block"]);
  const matching = (Array.isArray(slots) ? slots : []).filter(s => {
    if (!s || typeof s !== "object") return false;
    const mode = String(s.mode || "")
      .trim()
      .toLowerCase();
    if (!allowed.has(mode)) return false;
    return slotMatchesNow(s, now);
  });
  if (matching.length === 0) return null;
  matching.sort(
    (a, b) =>
      (MODE_PRIORITY[String(b.mode).toLowerCase()] || 0) -
      (MODE_PRIORITY[String(a.mode).toLowerCase()] || 0)
  );
  const m = String(matching[0].mode || "")
    .trim()
    .toLowerCase();
  return allowed.has(m) ? m : null;
}

function stableKeyForDesired(desired) {
  return desired == null ? "BASELINE" : desired;
}

module.exports = {
  computeDesiredNamedMode,
  stableKeyForDesired,
  slotMatchesNow
};
