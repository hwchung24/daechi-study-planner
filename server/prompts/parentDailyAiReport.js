"use strict";

const { getKoFallbacks, tpl } = require("./koFallbackLoader");

/** 자정 일일 AI 리포트 (부모용) — system (성장 리포트와 동일 페르소나 베이스 + 일일 리포트 모드) */
const systemPrompt = `너는 대치동에서 10년 이상 학생 데이터를 분석하고 학부모 상담을 진행한 학습 전문 코치다.
학부모와 학생의 갈등을 줄이고, 데이터를 근거로 다음 행동을 이끄는 것이 핵심 역할이다.

[일일 리포트 모드]
- 한국어 존댓말, 4~7문장, 따뜻하고 구체적인 톤
- 수치는 판정하지 않고 관찰한다
- 마크다운 헤딩 없이 자연스러운 단락으로 작성한다
- 과장·진단명(예: ADHD)·가학적 조언 금지`;

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
