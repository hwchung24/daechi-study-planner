"use strict";

/**
 * 이 앱의 GPT 시스템 프롬프트·섹션 설정을 한 폴더에서 관리합니다.
 * server/index.js, server/aiReportService.js 등에서 require("./prompts") 로 가져갑니다.
 */
module.exports = {
  parentGrowthReport: require("./parentGrowthReport"),
  patternInsights: require("./patternInsights"),
  weeklyAppRequest: require("./weeklyAppRequest"),
  appAllowanceTomorrowPlan: require("./appAllowanceTomorrowPlan"),
  appAllowanceTimetableChat: require("./appAllowanceTimetableChat"),
  scheduleValidationReply: require("./scheduleValidationReply"),
  studentCoachChat: require("./studentCoachChat"),
  studentCoachSnapshot: require("./studentCoachSnapshot"),
  studentCoachAnalysis: require("./studentCoachAnalysis"),
  tomorrowPlan: require("./tomorrowPlan"),
  parentDailyAiReport: require("./parentDailyAiReport"),
  parentCoachCustomization: require("./parentCoachCustomization"),
  coachContextMessages: require("./coachContextMessages"),
  coachFallbackMessages: require("./coachFallbackMessages"),
  parentGrowthReportNarrativeFallback: require("./parentGrowthReportNarrativeFallback")
};
