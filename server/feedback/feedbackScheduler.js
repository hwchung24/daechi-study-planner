"use strict";

const cron = require("node-cron");
const { refreshFewshotCandidates } = require("./fewshotManager");

const COACH_MODES = ["learning", "suneung", "tomorrowPlan", "patternInsights", "growthReport"];

let started = false;

/**
 * 매일 한국시간 02:00에 coach_mode별 few-shot 후보 갱신
 * (cursor-step3-fewshot.md의 `0 17 * * *` UTC 가정 표기와 달리, Asia/Seoul 기준 새벽 2시는 `0 2 * * *`.)
 */
function startFeedbackFewshotCron() {
  if (started) return;
  started = true;

  cron.schedule(
    "0 2 * * *",
    async () => {
      console.log("[feedbackScheduler] few-shot 갱신 시작");
      for (const mode of COACH_MODES) {
        try {
          await refreshFewshotCandidates(mode);
          console.log(`[feedbackScheduler] ${mode} 완료`);
        } catch (err) {
          console.error(`[feedbackScheduler] ${mode} 실패:`, err);
        }
      }
      console.log("[feedbackScheduler] 완료");
    },
    { timezone: "Asia/Seoul" }
  );

  console.log(
    "[cron] scheduled: feedback few-shot refresh at 02:00 KST (coach_response_log)"
  );
}

module.exports = { startFeedbackFewshotCron, COACH_MODES };
