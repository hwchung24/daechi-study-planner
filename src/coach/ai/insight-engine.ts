import type { DailyLog, NextAction, Severity, WeeklyInsight } from "../types";
import { detectPatterns } from "./pattern-detector";

function sortByDateAsc<T extends { date: string }>(xs: T[]) {
  return [...xs].sort((a, b) => a.date.localeCompare(b.date));
}

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function riskFromPatterns(patterns: Array<{ severity: Severity }>): Severity {
  const w = patterns.map(p => (p.severity === "높음" ? 3 : p.severity === "보통" ? 2 : 1));
  const s = w.reduce((a, b) => a + b, 0);
  if (s >= 10) return "높음";
  if (s >= 6) return "보통";
  return "낮음";
}

function chooseHeroNarrative(logs7d: DailyLog[], risk: Severity) {
  const sleepAvg = avg(logs7d.map(l => l.sleepHours));
  const mealsAvg = avg(logs7d.map(l => l.mealsRegularity));
  const stepsAvg = avg(logs7d.map(l => l.steps));
  const concAvg = avg(logs7d.map(l => l.concentrationScore));

  const lifestyleWobble =
    (sleepAvg < 6.2 ? 1 : 0) + (mealsAvg < 3.2 ? 1 : 0) + (stepsAvg < 3500 ? 1 : 0);

  if (lifestyleWobble >= 2 && concAvg <= 3.1) {
    return "단순 수면 부족이 아닙니다. 생활 리듬(식사·활동·회복)이 함께 흔들리면서 집중의 바닥이 내려갔어요.";
  }
  if (risk === "높음") {
    return "지금은 의지로 버티는 단계가 아니라, 루틴을 회복시키는 ‘구조 조정’이 필요한 타이밍이에요.";
  }
  if (concAvg <= 3.0) {
    return "집중이 떨어지는 날이 늘고 있어요. 시작 진입장벽을 낮추고, 첫 블록의 성공률을 올려봅시다.";
  }
  return "이번 주는 흐름이 나쁘지 않아요. 다만 작은 흔들림을 ‘습관’으로 굳히지 않도록 보정하면 더 안정적입니다.";
}

function chooseSummarySentence(metrics7d: WeeklyInsight["metrics7d"]) {
  if (metrics7d.length < 4) return "이번 주 데이터가 더 쌓이면 정확도가 올라가요.";
  const first = metrics7d.slice(0, Math.floor(metrics7d.length / 2));
  const last = metrics7d.slice(Math.floor(metrics7d.length / 2));
  const firstAvg = avg(first.map(m => m.concentration));
  const lastAvg = avg(last.map(m => m.concentration));
  const delta = Math.round(lastAvg - firstAvg);
  if (Math.abs(delta) < 3) return "이번 주 집중 흐름은 비교적 안정적이에요.";
  return delta > 0
    ? `이번 주는 집중도가 지난 구간보다 ${delta}% 상승했어요.`
    : `이번 주는 집중도가 지난 구간보다 ${Math.abs(delta)}% 하락했어요.`;
}

function nextActionsFromPatterns(patterns: WeeklyInsight["patterns"]): NextAction[] {
  const actions: NextAction[] = [];
  const add = (title: string, detail: string, tag: NextAction["tag"]) => {
    actions.push({ id: `act_${actions.length}_${title}`, title, detail, tag });
  };

  for (const p of patterns) {
    if (p.key === "sleep_deficit") {
      add("취침 시간을 20분만 당기기", "‘완벽’이 아니라 ‘연속 3일’이 목표예요.", "수면");
      add("첫 블록은 25분 가볍게 시작", "시작만 빠르게 만들면 뒤가 따라옵니다.", "집중");
    }
    if (p.key === "irregular_meals") {
      add("최소 1끼 식사 시간 고정", "시간만 고정해도 컨디션 변동이 줄어요.", "루틴");
    }
    if (p.key === "low_activity") {
      add("공부 시작 전 8~10분 걷기", "각성만 올리면 충분합니다.", "집중");
    }
    if (p.key === "high_stress") {
      add("오늘 목표는 ‘25분 시작’만", "양보다 ‘성공 경험’이 먼저예요.", "스트레스");
    }
    if (p.key === "plan_execution_gap") {
      add("오늘 할 일을 3개로 줄이기", "우선순위가 곧 실행력입니다.", "루틴");
      add("첫 할 일을 10분 단위로 쪼개기", "진입 장벽을 줄여요.", "집중");
    }
    if (p.key === "falling_concentration") {
      add("첫 블록은 ‘폰 시야 밖’으로", "쉬는 시간에만 확인 규칙을 만들어요.", "집중");
    }
  }

  // 중복 제거(제목 기준)
  const seen = new Set<string>();
  return actions.filter(a => {
    if (seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  }).slice(0, 6);
}

export function buildWeeklyInsight(studentId: string, logs: DailyLog[]): WeeklyInsight {
  const byStudent = logs.filter(l => l.studentId === studentId);
  const last7 = sortByDateAsc(byStudent).slice(-7);

  const metrics7d = last7.map(l => ({
    date: l.date,
    concentration: Math.round((l.concentrationScore / 5) * 100),
    studyMinutes: l.totalStudyMinutes,
    sleepHours: l.sleepHours
  }));

  const patterns = detectPatterns(last7);
  const riskLevel = riskFromPatterns(patterns);
  const heroNarrative = chooseHeroNarrative(last7, riskLevel);
  const summarySentence = chooseSummarySentence(metrics7d);
  const nextActions = nextActionsFromPatterns(patterns);

  return {
    studentId,
    weekStartDate: metrics7d[0]?.date || "",
    summarySentence,
    riskLevel,
    heroNarrative,
    metrics7d,
    patterns,
    nextActions
  };
}

