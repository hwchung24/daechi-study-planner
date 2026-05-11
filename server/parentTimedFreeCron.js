const db = require("./db");

let tickerStarted = false;
let tickerRunning = false;

/**
 * 학부모가 지정한 자유시간(분) 만료 시 기본 허용앱 프로파일로 복귀합니다.
 */
async function expireParentTimedFreeGrants(ensureBaselineAppAllowanceForStudent) {
  const rows = await db.listExpiredStudentParentTimedFree();
  for (const row of rows) {
    const sid = Number(row.student_user_id);
    if (!Number.isFinite(sid)) continue;
    try {
      await db.deleteStudentParentTimedFree(sid);
      await ensureBaselineAppAllowanceForStudent(sid, {
        reason: "parent_timed_free_expired",
        afterParentAppModeScheduleSlot: true
      });
    } catch (err) {
      console.error(
        `[cron] parent timed free revert student=${sid}:`,
        err && err.message ? err.message : err
      );
    }
  }
}

function startParentTimedFreeTicker(ensureBaselineAppAllowanceForStudent) {
  if (tickerStarted) return;
  tickerStarted = true;
  const intervalMs = 15_000;

  const tick = async () => {
    if (tickerRunning) return;
    tickerRunning = true;
    try {
      await expireParentTimedFreeGrants(ensureBaselineAppAllowanceForStudent);
    } catch (error) {
      console.error("[cron] parent timed free tick error", error);
    } finally {
      tickerRunning = false;
    }
  };

  setInterval(() => {
    void tick();
  }, intervalMs);

  console.log(`[cron] scheduled: parent timed free expiry every ${intervalMs}ms`);
}

module.exports = {
  expireParentTimedFreeGrants,
  startParentTimedFreeTicker
};
