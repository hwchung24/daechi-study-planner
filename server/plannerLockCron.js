const cron = require("node-cron");
const { reconcileAllPlannerLocks } = require("./lockService");
const { reconcilePlannerTimeKioskModes } = require("./kioskModeService");

let started = false;
let kioskReconcileRunning = false;

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

  const runKioskReconcile = async () => {
    if (kioskReconcileRunning) return;
    kioskReconcileRunning = true;
    try {
      const kioskResult = await reconcilePlannerTimeKioskModes();
      console.log("[cron] planner-time kiosk evaluation", kioskResult);
    } catch (error) {
      console.error("[cron] planner-time kiosk evaluation error", error);
    } finally {
      kioskReconcileRunning = false;
    }
  };

  void runKioskReconcile();
  setInterval(() => {
    void runKioskReconcile();
  }, 15_000);

  console.log(
    "[cron] scheduled: planner lock every minute (KST); planner-time kiosk every 15s"
  );
}

module.exports = { startPlannerLockCron };
