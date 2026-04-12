const cron = require("node-cron");
const { reconcileAllPlannerLocks } = require("./lockService");
const { reconcilePlannerTimeKioskModes } = require("./kioskModeService");

let started = false;

function startPlannerLockCron() {
  if (started) return;
  started = true;

  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const result = await reconcileAllPlannerLocks();
        const kioskResult = await reconcilePlannerTimeKioskModes();
        console.log("[cron] planner lock evaluation", result, kioskResult);
      } catch (error) {
        console.error("[cron] planner lock evaluation error", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log("[cron] scheduled: planner lock evaluator every minute (KST)");
}

module.exports = { startPlannerLockCron };
