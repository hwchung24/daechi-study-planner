import type { DailyLog, NextAction, Severity, WeeklyInsight } from "../types";
import { detectPatterns } from "./pattern-detector";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

function sortByDateAsc<T extends { date: string }>(xs: T[]) {
  return [...xs].sort((a, b) => a.date.localeCompare(b.date));
}

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function riskFromPatterns(patterns: Array<{ severity: Severity }>): Severity {
  const C = ko.common;
  const w = patterns.map(p =>
    p.severity === C.severityHigh ? 3 : p.severity === C.severityMid ? 2 : 1
  );
  const s = w.reduce((a, b) => a + b, 0);
  if (s >= 10) return C.severityHigh as Severity;
  if (s >= 6) return C.severityMid as Severity;
  return C.severityLow as Severity;
}

function chooseHeroNarrative(logs7d: DailyLog[], risk: Severity) {
  const IE = ko.localInsightEngine;
  const sleepAvg = avg(logs7d.map(l => l.sleepHours));
  const mealsAvg = avg(logs7d.map(l => l.mealsRegularity));
  const stepsAvg = avg(logs7d.map(l => l.steps));
  const concAvg = avg(logs7d.map(l => l.concentrationScore));

  const lifestyleWobble =
    (sleepAvg < 6.2 ? 1 : 0) + (mealsAvg < 3.2 ? 1 : 0) + (stepsAvg < 3500 ? 1 : 0);

  if (lifestyleWobble >= 2 && concAvg <= 3.1) {
    return IE.heroLifestyle;
  }
  if (risk === "높음") {
    return IE.heroRiskHigh;
  }
  if (concAvg <= 3.0) {
    return IE.heroConcLow;
  }
  return IE.heroDefault;
}

function chooseSummarySentence(metrics7d: WeeklyInsight["metrics7d"]) {
  const IE = ko.localInsightEngine;
  if (metrics7d.length < 4) return IE.summaryShortData;
  const first = metrics7d.slice(0, Math.floor(metrics7d.length / 2));
  const last = metrics7d.slice(Math.floor(metrics7d.length / 2));
  const firstAvg = avg(first.map(m => m.concentration));
  const lastAvg = avg(last.map(m => m.concentration));
  const delta = Math.round(lastAvg - firstAvg);
  if (Math.abs(delta) < 3) return IE.summaryStable;
  return delta > 0
    ? tpl(IE.summaryUp, { d: String(delta) })
    : tpl(IE.summaryDown, { d: String(Math.abs(delta)) });
}

function nextActionsFromPatterns(patterns: WeeklyInsight["patterns"]): NextAction[] {
  const NA = ko.localInsightNextActions;
  const actions: NextAction[] = [];
  const add = (title: string, detail: string, tag: NextAction["tag"]) => {
    actions.push({ id: `act_${actions.length}_${title}`, title, detail, tag });
  };

  for (const p of patterns) {
    if (p.key === "sleep_deficit") {
      add(NA.sleep1Title, NA.sleep1Detail, "수면");
      add(NA.sleep2Title, NA.sleep2Detail, "집중");
    }
    if (p.key === "irregular_meals") {
      add(NA.mealsTitle, NA.mealsDetail, "루틴");
    }
    if (p.key === "low_activity") {
      add(NA.activityTitle, NA.activityDetail, "집중");
    }
    if (p.key === "high_stress") {
      add(NA.stressTitle, NA.stressDetail, "스트레스");
    }
    if (p.key === "plan_execution_gap") {
      add(NA.planGap1Title, NA.planGap1Detail, "루틴");
      add(NA.planGap2Title, NA.planGap2Detail, "집중");
    }
    if (p.key === "falling_concentration") {
      add(NA.concTitle, NA.concDetail, "집중");
    }
  }

  const seen = new Set<string>();
  return actions
    .filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    })
    .slice(0, 6);
}

export function buildWeeklyInsight(studentId: string, logs: DailyLog[]): WeeklyInsight {
  const byStudent = logs.filter(l => l.studentId === studentId);
  const last7 = sortByDateAsc(byStudent).slice(-7);

  const metrics7d = last7.map(l => ({
    date: l.date,
    concentration: Math.round((l.concentrationScore / 5) * 100),
    studyMinutes: l.totalStudyMinutes,
    sleepHours: l.sleepHours,
    stressScore: l.stressScore,
    planCompletionRate: l.planCompletionRate
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
