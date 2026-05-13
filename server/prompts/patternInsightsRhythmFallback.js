"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

function hasAnyRhythmMetric(row) {
  return (
    row?.sleepHours != null ||
    row?.stressScore != null ||
    row?.concentrationPercent != null ||
    row?.studyMinutes != null ||
    row?.planCompletionRate != null
  );
}

function shortDateLabel(isoDate) {
  const s = String(isoDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s;
}

function formatMinutesAsHourLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "0시간";
  const hours = value / 60;
  if (hours >= 10) return `${Math.round(hours)}시간`;
  return `${hours.toFixed(1).replace(/\.0$/, "")}시간`;
}

function rhythmKo() {
  return getKoFallbacks().patternInsightsRhythm;
}

function deriveInsightParts(explanation, recommendation) {
  const rk = rhythmKo();
  const normalizedExplanation = String(explanation || "").trim();
  const normalizedRecommendation = String(recommendation || "").trim();
  const sentences = normalizedExplanation
    .split(/(?<=[.!?])\s+/)
    .map(line => line.trim())
    .filter(Boolean);
  const headline = (sentences[0] || normalizedExplanation || rk.deriveDefaultHeadline).slice(0, 120);
  const evidence = (sentences.slice(1).join(" ") || normalizedExplanation || headline).slice(0, 220);
  return {
    headline,
    evidence,
    action: (normalizedRecommendation || rk.deriveDefaultAction).slice(0, 180)
  };
}

function buildRhythmFallbackPattern(rhythmWeek, recordedDays, studyRoomSummary = null) {
  const rk = rhythmKo();
  const dt = rk.deltaTemplates;
  const cmp = rk.compareSummary;

  if (recordedDays < 2) {
    const b = rk.recordedFew;
    return {
      key: "ai_pat_0",
      title: b.title,
      severity: "낮음",
      explanation: b.explanation,
      recommendation: b.recommendation,
      headline: b.headline,
      evidence: b.evidence,
      action: b.action
    };
  }

  const rows = Array.isArray(rhythmWeek) ? rhythmWeek.filter(hasAnyRhythmMetric) : [];
  if (rows.length < 2) {
    const b = rk.scatteredMetrics;
    return {
      key: "ai_pat_0",
      title: b.title,
      severity: "낮음",
      explanation: b.explanation,
      recommendation: b.recommendation,
      headline: b.headline,
      evidence: b.evidence,
      action: b.action
    };
  }

  const totalStudyMinutes = rows.reduce(
    (sum, row) => sum + (row.studyMinutes != null ? Number(row.studyMinutes) : 0),
    0
  );
  const studyRoomMinutes =
    studyRoomSummary?.weeklyMinutes != null && Number.isFinite(Number(studyRoomSummary.weeklyMinutes))
      ? Number(studyRoomSummary.weeklyMinutes)
      : 0;
  if (studyRoomMinutes >= 240 && totalStudyMinutes > 0 && totalStudyMinutes < studyRoomMinutes * 0.45) {
    const b = rk.studyRoomExecution;
    const sr = formatMinutesAsHourLabel(studyRoomMinutes);
    const study = formatMinutesAsHourLabel(totalStudyMinutes);
    return {
      key: "ai_pat_0",
      title: b.title,
      severity: "보통",
      explanation: tpl(b.explanation, { sr, study }),
      recommendation: b.recommendation,
      headline: b.headline,
      evidence: tpl(b.evidence, { sr, study }),
      action: b.action
    };
  }

  const prev = rows[rows.length - 2];
  const curr = rows[rows.length - 1];
  const positive = [];
  const negative = [];

  if (prev.sleepHours != null && curr.sleepHours != null) {
    const d = curr.sleepHours - prev.sleepHours;
    if (d >= 0.8) positive.push(tpl(dt.sleepUp, { d: d.toFixed(1) }));
    else if (d <= -0.8) negative.push(tpl(dt.sleepDown, { d: Math.abs(d).toFixed(1) }));
  }
  if (prev.stressScore != null && curr.stressScore != null) {
    const d = curr.stressScore - prev.stressScore;
    if (d <= -0.6) positive.push(tpl(dt.stressDown, { d: Math.abs(d).toFixed(1) }));
    else if (d >= 0.6) negative.push(tpl(dt.stressUp, { d: d.toFixed(1) }));
  }
  if (prev.concentrationPercent != null && curr.concentrationPercent != null) {
    const d = curr.concentrationPercent - prev.concentrationPercent;
    if (d >= 8) positive.push(tpl(dt.concUp, { d: String(Math.round(d)) }));
    else if (d <= -8) negative.push(tpl(dt.concDown, { d: String(Math.round(Math.abs(d))) }));
  }
  if (prev.studyMinutes != null && curr.studyMinutes != null) {
    const d = curr.studyMinutes - prev.studyMinutes;
    if (d >= 30) positive.push(tpl(dt.studyUp, { d: String(Math.round(d)) }));
    else if (d <= -30) negative.push(tpl(dt.studyDown, { d: String(Math.round(Math.abs(d))) }));
  }
  if (prev.planCompletionRate != null && curr.planCompletionRate != null) {
    const d = curr.planCompletionRate - prev.planCompletionRate;
    if (d >= 10) positive.push(tpl(dt.planUp, { d: String(Math.round(d)) }));
    else if (d <= -10) negative.push(tpl(dt.planDown, { d: String(Math.round(Math.abs(d))) }));
  }

  const compareLabel = `${shortDateLabel(prev.date)} 대비 ${shortDateLabel(curr.date)}`;
  const summaryParts = [];
  if (positive.length) summaryParts.push(`${cmp.positivePrefix}${positive.slice(0, 2).join(", ")}`);
  if (negative.length) summaryParts.push(`${cmp.negativePrefix}${negative.slice(0, 2).join(", ")}`);
  if (!summaryParts.length) {
    summaryParts.push(cmp.neutralFlow);
  }

  const explPrefix = rk.explanationPrefix || " 기준으로 ";
  let recommendation = rk.recoDefault;
  if (negative.some(s => s.includes("수면시간"))) {
    recommendation = rk.recoSleep;
  } else if (negative.some(s => s.includes("스트레스"))) {
    recommendation = rk.recoStress;
  } else if (negative.some(s => s.includes("집중도"))) {
    recommendation = rk.recoConc;
  } else if (negative.some(s => s.includes("공부시간"))) {
    recommendation = rk.recoStudy;
  } else if (negative.some(s => s.includes("목표 달성률"))) {
    recommendation = rk.recoPlan;
  }

  const fallback = {
    key: "ai_pat_0",
    title: rk.twoDayTitle,
    severity: negative.length >= 2 ? "높음" : negative.length === 1 ? "보통" : "낮음",
    explanation: `${compareLabel}${explPrefix}${summaryParts.join(". ")}.`,
    recommendation
  };
  const insightParts = deriveInsightParts(fallback.explanation, fallback.recommendation);
  return {
    ...fallback,
    headline: insightParts.headline,
    evidence: insightParts.evidence,
    action: insightParts.action
  };
}

module.exports = {
  hasAnyRhythmMetric,
  deriveInsightParts,
  buildRhythmFallbackPattern
};
