const cron = require("node-cron");

const {
  reconcileAllStudentWeeklyAppAllowances
} = require("./weeklyAppAllowanceEnforcement");

let started = false;

function startWeeklyAppAllowanceCron(options = {}) {
  if (started) return;
  started = true;
  const afterWeeklyReconcile = options.afterWeeklyReconcile;

  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const result = await reconcileAllStudentWeeklyAppAllowances({
          reason: "cron"
        });
        console.log("[cron] weekly app allowance evaluation", result);
      } catch (error) {
        console.error("[cron] weekly app allowance evaluation error", error);
      }
      if (typeof afterWeeklyReconcile === "function") {
        try {
          await afterWeeklyReconcile();
        } catch (error) {
          console.error("[cron] after weekly app allowance hook error", error);
        }
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log("[cron] scheduled: weekly app allowance evaluator every minute (KST)");
}

module.exports = { startWeeklyAppAllowanceCron };