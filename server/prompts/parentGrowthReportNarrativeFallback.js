"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");
const {
  buildNextWeekSuggestionsFallback,
  isGenericWellnessSuggestion
} = require("./parentGrowthReport");

function narr() {
  return getKoFallbacks().parentGrowthReportNarrative;
}

function buildStudyEfficiencyInsightFallback(studyRoomHours, actualStudyHours) {
  const n = narr();
  if (studyRoomHours > 0) {
    return tpl(n.studyEfficiencyWithRoom, {
      srh: studyRoomHours.toFixed(1),
      ash: actualStudyHours.toFixed(1)
    });
  }
  return n.studyEfficiencyNoRoom;
}

/**
 * GPT 섹션이 비었을 때 성장 리포트 narrative 빈칸을 채움 (객체를 제자리에서 수정).
 * @param {Record<string, string>} narrative
 * @param {{ lines: string[]; studyRoomHours: number; actualStudyHours: number; planLists: { completedCount: number } }} ctx
 */
function fillParentGrowthReportNarrativeGaps(narrative, ctx) {
  const n = narr();
  const nar = narrative || {};
  const lines = Array.isArray(ctx?.lines) ? ctx.lines : [];
  if (!nar.weeklySummary) {
    nar.weeklySummary = lines.slice(0, 2).join(" ") || n.defaultWeeklySummaryTail;
  }
  if (!nar.energyParentTip) {
    nar.energyParentTip = n.defaultEnergyParentTip;
  }
  if (!nar.studyEfficiencyInsight) {
    nar.studyEfficiencyInsight = buildStudyEfficiencyInsightFallback(
      Number(ctx?.studyRoomHours) || 0,
      Number(ctx?.actualStudyHours) || 0
    );
  }
  if (!nar.planExecutionSummary) {
    nar.planExecutionSummary =
      (ctx?.planLists?.completedCount || 0) > 0 ? n.planExecutionWhenCompleted : n.planExecutionWhenEmpty;
  }
  const patternFallback = ctx?.patternFallback;
  const suggestionPattern = ctx?.suggestionPattern || {};
  if (!nar.nextWeekForStudent || isGenericWellnessSuggestion(nar.nextWeekForStudent)) {
    nar.nextWeekForStudent =
      patternFallback?.studentSuggestion ||
      buildNextWeekSuggestionsFallback(suggestionPattern).studentSuggestion ||
      n.nextWeekForStudentDefault;
  }
  if (!nar.nextWeekForParent || isGenericWellnessSuggestion(nar.nextWeekForParent)) {
    nar.nextWeekForParent =
      patternFallback?.parentSuggestion ||
      buildNextWeekSuggestionsFallback(suggestionPattern).parentSuggestion ||
      n.nextWeekForParentDefault;
  }
}

module.exports = {
  fillParentGrowthReportNarrativeGaps
};
