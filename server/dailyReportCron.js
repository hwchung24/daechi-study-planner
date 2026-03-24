const cron = require("node-cron");
const { runDailyReportsForAllPairs } = require("./aiReportService");

let started = false;

/**
 * 매일 한국시간 00:00에 전체 부모–자녀 쌍에 대해 AI 일일 리포트 생성
 */
function startDailyAiReportCron() {
  if (started) return;
  started = true;

  cron.schedule(
    "0 0 * * *",
    async () => {
      console.log("[cron] daily AI report job start (Asia/Seoul 00:00)");
      try {
        const r = await runDailyReportsForAllPairs();
        console.log("[cron] daily AI report job done", r);
      } catch (e) {
        console.error("[cron] daily AI report job error", e);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log(
    "[cron] scheduled: daily AI reports at 00:00 KST (gpt-4o-mini)"
  );
}

module.exports = { startDailyAiReportCron };
