const db = require("./db");

let tickerStarted = false;
let tickerRunning = false;

/**
 * 학부모 자유시간(분) 만료 시 free 프로파일을 걷고 진입 직전 스냅샷으로 복구합니다.
 */
async function expireParentTimedFreeGrants(restoreAfterParentTimedFree) {
  const rows = await db.listExpiredStudentParentTimedFree();
  for (const row of rows) {
    const sid = Number(row.student_user_id);
    if (!Number.isFinite(sid)) continue;
    const snapshot = row.restore_snapshot;
    try {
      await db.deleteStudentParentTimedFree(sid);
      await restoreAfterParentTimedFree(sid, snapshot);
    } catch (err) {
      console.error(
        `[cron] parent timed free revert student=${sid}:`,
        err && err.message ? err.message : err
      );
    }
  }
}

function startParentTimedFreeTicker(restoreAfterParentTimedFree) {
  if (tickerStarted) return;
  tickerStarted = true;
  const intervalMs = 15_000;

  const tick = async () => {
    if (tickerRunning) return;
    tickerRunning = true;
    try {
      await expireParentTimedFreeGrants(restoreAfterParentTimedFree);
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
