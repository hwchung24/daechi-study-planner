"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

/** 자정 일일 AI 리포트 (부모용) — system 한 줄 */
const systemPrompt =
  "You write short parent-facing study reports in Korean. No markdown headings unless user asks.";

function pdr() {
  return getKoFallbacks().parentDailyAiReport;
}

/**
 * 일일 리포트용 user 메시지 (역할·규칙·요약 줄·통계 JSON).
 * @param {string[]} summaryLines
 * @param {string} statsPrompt
 */
function buildUserContent(summaryLines, statsPrompt) {
  const p = pdr();
  const lines = Array.isArray(summaryLines) ? summaryLines : [];
  return [
    p.userContentRole,
    p.userContentIntro,
    p.userContentTask,
    "",
    p.userContentRulesHeader,
    p.userContentRule1,
    p.userContentRule2,
    p.userContentRule3,
    "",
    p.userContentSummaryHeader,
    ...lines.map(l => `- ${l}`),
    "",
    p.userContentStatsHeader,
    String(statsPrompt ?? "")
  ].join("\n");
}

/** 주간 통계 → 일일 AI 리포트용 요약 줄 (GPT user에 포함) */
function buildWeeklySummaryLines(stats) {
  const p = pdr();
  const hours = Math.floor(stats.totalStudyMinutes / 60);
  const mins = stats.totalStudyMinutes % 60;

  const mainSubject =
    stats.subjectTimes && stats.subjectTimes.length > 0 ? stats.subjectTimes[0].subject : null;

  const bestCompletion =
    stats.completionRates && stats.completionRates.length > 0 ? stats.completionRates[0] : null;

  const worstCompletion =
    stats.completionRates && stats.completionRates.length > 0
      ? stats.completionRates[stats.completionRates.length - 1]
      : null;

  const lines = [];

  lines.push(
    tpl(p.weeklyLinePeriod, {
      weekStart: stats.weekStart,
      weekEnd: stats.weekEnd,
      hours: String(hours),
      mins: String(mins)
    })
  );

  if (mainSubject) {
    lines.push(tpl(p.weeklyLineMainSubject, { subject: mainSubject }));
  }

  if (bestCompletion) {
    lines.push(
      tpl(p.weeklyLineBestCompletion, {
        subject: bestCompletion.subject,
        pct: String(bestCompletion.avgFinalPct)
      })
    );
  }

  if (worstCompletion && worstCompletion !== bestCompletion) {
    lines.push(
      tpl(p.weeklyLineWorstCompletion, {
        subject: worstCompletion.subject,
        pct: String(worstCompletion.avgFinalPct)
      })
    );
  }

  if (stats.consecutiveAbsentDays >= 2) {
    lines.push(tpl(p.weeklyLineAbsent, { days: String(stats.consecutiveAbsentDays) }));
  }

  return lines;
}

function buildWeeklyReportPrompt(stats) {
  const p = pdr();
  const baseJson = JSON.stringify(stats, null, 2);
  return [p.weeklyReportPromptIntro, p.weeklyReportPromptTask, "", baseJson].join("\n");
}

module.exports = {
  systemPrompt,
  buildUserContent,
  buildWeeklySummaryLines,
  buildWeeklyReportPrompt,
  temperature: 0.45,
  maxTokens: 700
};
