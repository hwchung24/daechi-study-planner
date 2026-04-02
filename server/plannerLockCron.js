const cron = require("node-cron");
const { reconcileAllPlannerLocks } = require("./lockService");

let started = false;

function startPlannerLockCron() {
  if (started) return;
  started = true;

  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const result = await reconcileAllPlannerLocks();
        console.log("[cron] planner lock evaluation", result);
      } catch (error) {
        console.error("[cron] planner lock evaluation error", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log("[cron] scheduled: planner lock evaluator every minute (KST)");
}

module.exports = { startPlannerLockCron };
