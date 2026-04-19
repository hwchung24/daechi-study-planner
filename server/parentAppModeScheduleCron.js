const db = require("./db");
const {
  computeDesiredNamedMode,
  stableKeyForDesired
} = require("./parentAppModeSchedule");

const lastAppliedByStudentId = new Map();

/**
 * 학부모가 DB에 저장한 모드 시간표에 맞춰 MDM 이름 프로파일을 적용합니다.
 * `weeklyAppAllowanceCron`에서 주간 reconcile 직후 호출됩니다.
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

module.exports = { runParentAppModeScheduleEnforcement };
