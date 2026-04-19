const db = require("./db");
const {
  computeDesiredNamedMode,
  stableKeyForDesired
} = require("./parentAppModeSchedule");

const lastAppliedByStudentId = new Map();

let tickerStarted = false;
let tickerRunning = false;

function resolveParentAppModeScheduleTickMs() {
  const raw = String(process.env.PARENT_APP_MODE_SCHEDULE_TICK_MS || "")
    .trim()
    .replace(/_/g, "");
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 60_000) {
    return Math.floor(parsed);
  }
  return 5000;
}

/**
 * 학부모가 DB에 저장한 모드 시간표에 맞춰 MDM 이름 프로파일을 적용합니다.
 * 주간 허용앱 크론과 분리해 더 촘촘히 돌립니다(기본 5초, `PARENT_APP_MODE_SCHEDULE_TICK_MS`로 2000~60000 조정).
 */
async function runParentAppModeScheduleEnforcement({
  applyNamedAppAllowanceProfileForStudent,
  ensureBaselineAppAllowanceForStudent
}) {
  const rows = await db.listAllParentStudentAppModeScheduleRows();
  const now = new Date();
  const byStudent = new Map();

  for (const row of rows) {
    const sid = Number(row.student_user_id);
    if (!Number.isFinite(sid)) continue;
    let slots = row.slots;
    if (slots == null) slots = [];
    if (typeof slots === "string") {
      try {
        slots = JSON.parse(slots);
      } catch {
        slots = [];
      }
    }
    if (!Array.isArray(slots)) slots = [];
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid).push(...slots);
  }

  for (const [studentId, mergedSlots] of byStudent) {
    const prev = lastAppliedByStudentId.get(studentId);

    if (!mergedSlots.length) {
      if (prev === undefined || prev === "BASELINE") {
        lastAppliedByStudentId.delete(studentId);
        continue;
      }
      try {
        await ensureBaselineAppAllowanceForStudent(studentId, {
          reason: "parent_app_mode_schedule_cleared",
          afterParentAppModeScheduleSlot: true
        });
        lastAppliedByStudentId.set(studentId, "BASELINE");
      } catch (err) {
        console.error(
          `[cron] parent app mode schedule student=${studentId}:`,
          err && err.message ? err.message : err
        );
      }
      continue;
    }

    const desired = computeDesiredNamedMode(mergedSlots, now);
    const key = stableKeyForDesired(desired);
    if (prev === key) continue;

    const scheduleExitedActive =
      prev === "utility" || prev === "free" || prev === "block";

    try {
      if (desired != null) {
        await applyNamedAppAllowanceProfileForStudent(studentId, desired);
      } else {
        await ensureBaselineAppAllowanceForStudent(studentId, {
          reason: "parent_app_mode_schedule",
          afterParentAppModeScheduleSlot: Boolean(scheduleExitedActive)
        });
      }
      lastAppliedByStudentId.set(studentId, key);
    } catch (err) {
      console.error(
        `[cron] parent app mode schedule student=${studentId}:`,
        err && err.message ? err.message : err
      );
    }
  }
}

function startParentAppModeScheduleTicker(handlers) {
  if (tickerStarted) return;
  tickerStarted = true;
  const intervalMs = resolveParentAppModeScheduleTickMs();

  const tick = async () => {
    if (tickerRunning) return;
    tickerRunning = true;
    try {
      await runParentAppModeScheduleEnforcement(handlers);
    } catch (error) {
      console.error("[cron] parent app mode schedule tick error", error);
    } finally {
      tickerRunning = false;
    }
  };

  setInterval(() => {
    void tick();
  }, intervalMs);

  console.log(
    `[cron] scheduled: parent app mode schedule enforcement every ${intervalMs}ms`
  );
}

module.exports = {
  runParentAppModeScheduleEnforcement,
  startParentAppModeScheduleTicker
};
