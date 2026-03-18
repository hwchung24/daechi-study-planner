// JS version of analytics helpers (for Node runtime)

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesDiff(start, end) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

function computeWeeklyStats(input) {
  const { days, blocks, plans } = input;
  if (!days || days.length === 0) {
    return {
      weekStart: "",
      weekEnd: "",
      totalStudyMinutes: 0,
      subjectTimes: [],
      completionRates: [],
      focusDistribution: { best: 0, good: 0, ok: 0, bad: 0 },
      consecutiveAbsentDays: 0,
      mostDeferredSubjects: []
    };
  }

  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const weekStart = sortedDays[0].date;
  const weekEnd = sortedDays[sortedDays.length - 1].date;

  // 총 학습 시간 + 과목별
  const subjectMinutes = new Map();
  let totalStudyMinutes = 0;
  for (const b of blocks || []) {
    const minutes = minutesDiff(b.start_time, b.end_time);
    totalStudyMinutes += minutes;
    subjectMinutes.set(
      b.subject,
      (subjectMinutes.get(b.subject) || 0) + minutes
    );
  }
  const subjectTimes = Array.from(subjectMinutes.entries())
    .map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // 완료율 (book_id 기준)
  const subjectCompletion = new Map();
  for (const p of plans || []) {
    if (p.final_pct == null) continue;
    const key = String(p.book_id);
    const agg = subjectCompletion.get(key) || { sum: 0, count: 0 };
    agg.sum += p.final_pct;
    agg.count += 1;
    subjectCompletion.set(key, agg);
  }
  const completionRates = Array.from(subjectCompletion.entries())
    .map(([key, { sum, count }]) => ({
      subject: `book#${key}`,
      avgFinalPct: count > 0 ? Math.round(sum / count) : 0
    }))
    .sort((a, b) => b.avgFinalPct - a.avgFinalPct);

  // 집중도 분포
  const focusDistribution = { best: 0, good: 0, ok: 0, bad: 0 };
  for (const b of blocks || []) {
    if (b.focus_score === "◎") focusDistribution.best += 1;
    else if (b.focus_score === "○") focusDistribution.good += 1;
    else if (b.focus_score === "△") focusDistribution.ok += 1;
    else if (b.focus_score === "✕") focusDistribution.bad += 1;
  }

  // 연속 결석일 수
  const dayHasStudy = new Map();
  for (const d of days) dayHasStudy.set(d.date, false);
  for (const b of blocks || []) {
    const day = days.find(d => d.id === b.study_day_id);
    if (!day) continue;
    if (minutesDiff(b.start_time, b.end_time) > 0) {
      dayHasStudy.set(day.date, true);
    }
  }
  let consecutiveAbsentDays = 0;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const d = sortedDays[i];
    if (dayHasStudy.get(d.date)) break;
    consecutiveAbsentDays += 1;
  }

  const deferred = completionRates
    .filter(c => c.avgFinalPct <= 60)
    .map(c => ({ subject: c.subject, lowCompletionCount: 1 }));

  return {
    weekStart,
    weekEnd,
    totalStudyMinutes,
    subjectTimes,
    completionRates,
    focusDistribution,
    consecutiveAbsentDays,
    mostDeferredSubjects: deferred
  };
}

function buildWeeklySummaryLines(stats) {
  const hours = Math.floor(stats.totalStudyMinutes / 60);
  const mins = stats.totalStudyMinutes % 60;

  const mainSubject =
    stats.subjectTimes && stats.subjectTimes.length > 0
      ? stats.subjectTimes[0].subject
      : null;

  const bestCompletion =
    stats.completionRates && stats.completionRates.length > 0
      ? stats.completionRates[0]
      : null;

  const worstCompletion =
    stats.completionRates && stats.completionRates.length > 0
      ? stats.completionRates[stats.completionRates.length - 1]
      : null;

  const lines = [];

  lines.push(
    `이번 주 학습 기간은 ${stats.weekStart} ~ ${stats.weekEnd}이며, 총 학습 시간은 약 ${hours}시간 ${mins}분입니다.`
  );

  if (mainSubject) {
    lines.push(`가장 많은 시간을 투자한 과목은 「${mainSubject}」입니다.`);
  }

  if (bestCompletion) {
    lines.push(
      `계획 대비 완료율이 가장 높은 교재는 ${bestCompletion.subject}로 평균 ${bestCompletion.avgFinalPct}%를 기록했습니다.`
    );
  }

  if (worstCompletion && worstCompletion !== bestCompletion) {
    lines.push(
      `완료율이 상대적으로 낮은 교재는 ${worstCompletion.subject}로 평균 ${worstCompletion.avgFinalPct}% 수준입니다.`
    );
  }

  if (stats.consecutiveAbsentDays >= 2) {
    lines.push(
      `최근 ${stats.consecutiveAbsentDays}일 연속으로 학습 기록이 없어, 일정 관리에 추가적인 점검이 필요해 보입니다.`
    );
  }

  return lines;
}

module.exports = {
  computeWeeklyStats,
  buildWeeklySummaryLines
};

