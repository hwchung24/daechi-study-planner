import type { DailyLog, DetectedPattern, Severity } from "../types";
import ko from "../fallbacks/ko.json";

const PD = ko.localPatternDetector.patterns;
const C = ko.common;

function sev(n: number): Severity {
  if (n >= 0.72) return C.severityHigh as Severity;
  if (n >= 0.42) return C.severityMid as Severity;
  return C.severityLow as Severity;
}

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function detectPatterns(logs7d: DailyLog[]): DetectedPattern[] {
  if (logs7d.length === 0) return [];

  const sleepAvg = avg(logs7d.map(l => l.sleepHours));
  const concAvg = avg(logs7d.map(l => l.concentrationScore));
  const stressAvg = avg(logs7d.map(l => l.stressScore));
  const stepsAvg = avg(logs7d.map(l => l.steps));
  const mealsAvg = avg(logs7d.map(l => l.mealsRegularity));
  const planAvg = avg(logs7d.map(l => l.planCompletionRate));
  const phoneAvg = avg(logs7d.map(l => l.phoneDistractions));

  const last2 = logs7d.slice(-2);
  const sleepDeficit2d =
    last2.length === 2 && last2.every(l => l.sleepHours < 6.0);

  const patterns: DetectedPattern[] = [];

  {
    const score = clamp01(
      (sleepDeficit2d ? 0.55 : 0) + (6.6 - sleepAvg) / 1.6
    );
    if (score > 0.18) {
      const d = PD.sleep_deficit;
      patterns.push({
        key: "sleep_deficit",
        title: d.title,
        severity: sev(score),
        explanation: d.explanation,
        whyItMatters: d.whyItMatters,
        recommendation: d.recommendation
      });
    }
  }

  {
    const score = clamp01((3.7 - mealsAvg) / 2.2);
    if (score > 0.22) {
      const d = PD.irregular_meals;
      patterns.push({
        key: "irregular_meals",
        title: d.title,
        severity: sev(score),
        explanation: d.explanation,
        whyItMatters: d.whyItMatters,
        recommendation: d.recommendation
      });
    }
  }

  {
    const score = clamp01((5200 - stepsAvg) / 4200);
    if (score > 0.22) {
      const d = PD.low_activity;
      patterns.push({
        key: "low_activity",
        title: d.title,
        severity: sev(score),
        explanation: d.explanation,
        whyItMatters: d.whyItMatters,
        recommendation: d.recommendation
      });
    }
  }

  {
    const score = clamp01((stressAvg - 3.1) / 1.6);
    if (score > 0.2) {
      const d = PD.high_stress;
      patterns.push({
        key: "high_stress",
        title: d.title,
        severity: sev(score),
        explanation: d.explanation,
        whyItMatters: d.whyItMatters,
        recommendation: d.recommendation
      });
    }
  }

  {
    const score = clamp01((3.4 - concAvg) / 1.6 + (phoneAvg - 9) / 18);
    if (score > 0.28) {
      const d = PD.falling_concentration;
      patterns.push({
        key: "falling_concentration",
        title: d.title,
        severity: sev(score),
        explanation: d.explanation,
        whyItMatters: d.whyItMatters,
        recommendation: d.recommendation
      });
    }
  }

  {
    const score = clamp01((60 - planAvg) / 35);
    if (score > 0.25) {
      const d = PD.plan_execution_gap;
      patterns.push({
        key: "plan_execution_gap",
        title: d.title,
        severity: sev(score),
        explanation: d.explanation,
        whyItMatters: d.whyItMatters,
        recommendation: d.recommendation
      });
    }
  }

  return patterns;
}
