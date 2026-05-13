// JS version of analytics helpers (for Node runtime)

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesDiff(start, end) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

function normalizeDateKey(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return "";
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
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

  const normalizedDays = days
    .map(day => ({ ...day, date: normalizeDateKey(day.date) }))
    .filter(day => day.date);
  if (normalizedDays.length === 0) {
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

  const sortedDays = [...normalizedDays].sort((a, b) => a.date.localeCompare(b.date));
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
  for (const d of normalizedDays) dayHasStudy.set(d.date, false);
  const dayById = new Map(normalizedDays.map(d => [d.id, d]));
  for (const b of blocks || []) {
    const day = dayById.get(b.study_day_id);
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

module.exports = {
  computeWeeklyStats
};

