"use strict";

const { hasAnyRhythmMetric } = require("./patternInsightsRhythmFallback");
const { getKoFallbacks, tpl } = require("./koFallbackLoader");

function formatMinutesAsHourLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "0시간";
  const hours = value / 60;
  if (hours >= 10) return `${Math.round(hours)}시간`;
  return `${hours.toFixed(1).replace(/\.0$/, "")}시간`;
}

function buildAnalysisMetric(key, title, value, hint, tone = "neutral") {
  return { key, title, value, hint, tone };
}

function analysisKo() {
  return getKoFallbacks().studentCoachAnalysis;
}

function defaultNext0() {
  return getKoFallbacks().studentCoachSnapshot.defaultNextActions[0];
}

/**
 * 학생 코치 홈 분석 카드(규칙 기반, GPT 아님).
 * @param {object} metrics
 * @param {string[]|null|undefined} nextActions
 * @param {unknown[]} rhythmWeek
 * @param {object|null} studyRoomSummary
 */
function buildStudentCoachAnalysis(metrics, nextActions, rhythmWeek, studyRoomSummary) {
  const a = analysisKo();
  const recordedDays = Array.isArray(rhythmWeek) ? rhythmWeek.filter(hasAnyRhythmMetric).length : 0;
  const totalStudyMinutes = (Array.isArray(rhythmWeek) ? rhythmWeek : []).reduce(
    (sum, row) =>
      sum +
      (row?.studyMinutes != null && Number.isFinite(Number(row.studyMinutes))
        ? Number(row.studyMinutes)
        : 0),
    0
  );
  const sleep =
    metrics?.sleepHours != null && Number.isFinite(Number(metrics.sleepHours))
      ? Number(metrics.sleepHours)
      : null;
  const concentration =
    metrics?.concentration != null && Number.isFinite(Number(metrics.concentration))
      ? Number(metrics.concentration)
      : null;
  const concentrationPercent =
    concentration == null ? null : Math.round((concentration / 5) * 100);
  const stress =
    metrics?.stress != null && Number.isFinite(Number(metrics.stress)) ? Number(metrics.stress) : null;
  const plan =
    metrics?.planCompletionRate != null && Number.isFinite(Number(metrics.planCompletionRate))
      ? Number(metrics.planCompletionRate)
      : null;
  const studyRoomMinutes =
    studyRoomSummary?.weeklyMinutes != null && Number.isFinite(Number(studyRoomSummary.weeklyMinutes))
      ? Number(studyRoomSummary.weeklyMinutes)
      : 0;
  const studyRoomActiveDays =
    studyRoomSummary?.activeDays != null && Number.isFinite(Number(studyRoomSummary.activeDays))
      ? Number(studyRoomSummary.activeDays)
      : 0;

  let statusLabel = a.defaultStatusLabel;
  let headline = a.defaultHeadline;
  let body = a.defaultBody;
  let recommendedAction = nextActions?.[0] || defaultNext0();
  let focusMetricKey = "studyMinutes";

  if (
    studyRoomMinutes >= 240 &&
    totalStudyMinutes > 0 &&
    totalStudyMinutes < studyRoomMinutes * 0.45
  ) {
    const b = a.branchStudyRoom;
    statusLabel = b.statusLabel;
    headline = b.headline;
    body = tpl(b.body, {
      sr: formatMinutesAsHourLabel(studyRoomMinutes),
      study: formatMinutesAsHourLabel(totalStudyMinutes)
    });
    recommendedAction = b.recommendedAction;
    focusMetricKey = "studyRoomMinutes";
  } else if (stress != null && stress >= 3.8) {
    const b = a.branchStress;
    statusLabel = b.statusLabel;
    headline = b.headline;
    body = b.body;
    recommendedAction = b.recommendedAction;
    focusMetricKey = "concentration";
  } else if (
    sleep != null &&
    sleep < 6.2 &&
    concentrationPercent != null &&
    concentrationPercent < 65
  ) {
    const b = a.branchSleepConc;
    statusLabel = b.statusLabel;
    headline = b.headline;
    body = tpl(b.body, {
      sleep: sleep.toFixed(1),
      conc: String(concentrationPercent)
    });
    recommendedAction = b.recommendedAction;
    focusMetricKey = "sleepHours";
  } else if (plan != null && plan < 60) {
    const b = a.branchPlan;
    statusLabel = b.statusLabel;
    headline = b.headline;
    body = tpl(b.body, { plan: String(Math.round(plan)) });
    recommendedAction = b.recommendedAction;
    focusMetricKey = "planCompletionRate";
  } else if (studyRoomMinutes >= 360 || totalStudyMinutes >= 420) {
    const bRoom = a.branchStableWithRoom;
    const bNo = a.branchStableNoRoom;
    statusLabel = bRoom.statusLabel;
    headline = bRoom.headline;
    body =
      studyRoomMinutes > 0
        ? tpl(bRoom.body, {
            sr: formatMinutesAsHourLabel(studyRoomMinutes),
            study: formatMinutesAsHourLabel(totalStudyMinutes)
          })
        : tpl(bNo.body, { study: formatMinutesAsHourLabel(totalStudyMinutes) });
    recommendedAction = bRoom.recommendedAction;
    focusMetricKey =
      studyRoomMinutes > totalStudyMinutes ? "studyRoomMinutes" : "studyMinutes";
  }

  const highlightMetrics = [];
  if (sleep != null) {
    highlightMetrics.push(
      buildAnalysisMetric(
        "sleepHours",
        a.highlightSleepTitle,
        `${sleep.toFixed(1)}시간`,
        sleep >= 6.5 ? a.highlightSleepHintGood : a.highlightSleepHintWarn,
        sleep >= 6.5 ? "good" : "warn"
      )
    );
  }
  if (concentrationPercent != null) {
    highlightMetrics.push(
      buildAnalysisMetric(
        "concentration",
        a.highlightConcTitle,
        `${concentrationPercent}%`,
        concentrationPercent >= 70 ? a.highlightConcHintGood : a.highlightConcHintWarn,
        concentrationPercent >= 70 ? "good" : "warn"
      )
    );
  }
  if (studyRoomMinutes > 0) {
    highlightMetrics.push(
      buildAnalysisMetric(
        "studyRoomMinutes",
        a.highlightRoomTitle,
        formatMinutesAsHourLabel(studyRoomMinutes),
        `${studyRoomActiveDays}${a.highlightRoomHintSuffix}${
          studyRoomSummary?.consistencyLabel || a.highlightRoomEnvFallback
        }`,
        studyRoomActiveDays >= 3 ? "good" : "neutral"
      )
    );
  } else if (plan != null) {
    highlightMetrics.push(
      buildAnalysisMetric(
        "planCompletionRate",
        a.highlightPlanTitle,
        `${Math.round(plan)}%`,
        plan >= 65 ? a.highlightPlanHintGood : a.highlightPlanHintWarn,
        plan >= 65 ? "good" : "warn"
      )
    );
  }

  return {
    statusLabel,
    headline,
    body,
    recommendedAction,
    focusMetricKey,
    pills: [
      { label: a.pillLabelRecord, value: `${recordedDays}일` },
      studyRoomMinutes > 0
        ? {
            label: a.pillLabelStudyRoom,
            value: `${studyRoomActiveDays}일 · ${formatMinutesAsHourLabel(studyRoomMinutes)}`
          }
        : { label: a.pillLabelPlan, value: plan != null ? `${Math.round(plan)}%` : a.pillPlanPending }
    ],
    highlightMetrics: highlightMetrics.slice(0, 3)
  };
}

module.exports = {
  buildStudentCoachAnalysis
};
