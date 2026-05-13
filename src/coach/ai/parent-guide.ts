import type { DailyLog, Severity, WeeklyInsight } from "../types";
import ko from "../fallbacks/ko.json";

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export type AdminGuide = {
  urgency: Severity;
  headline: string;
  guidanceLines: string[];
  suggestedPhrases: string[];
  intervention: "관찰" | "칭찬" | "질문 1개" | "루틴 도움" | "상담 권장";
};

const C = ko.common;
const G = ko.parentAdminGuide;
const Iv = G.intervention;
const SP = G.suggestedPhrases;

export function buildAdminGuide(insight: WeeklyInsight, logs7d: DailyLog[]): AdminGuide {
  const concAvg = avg(logs7d.map(l => l.concentrationScore));
  const stressAvg = avg(logs7d.map(l => l.stressScore));
  const sleepAvg = avg(logs7d.map(l => l.sleepHours));
  const planAvg = avg(logs7d.map(l => l.planCompletionRate));

  const urgency = insight.riskLevel;

  const intervention = (
    urgency === C.severityHigh
      ? stressAvg >= 4.0
        ? Iv.counseling
        : Iv.routineHelp
      : urgency === C.severityMid
        ? planAvg < 60
          ? Iv.oneQuestion
          : Iv.praise
        : Iv.observe
  ) as AdminGuide["intervention"];

  const headline =
    urgency === C.severityHigh
      ? G.headline.high
      : urgency === C.severityMid
        ? G.headline.mid
        : G.headline.low;

  const guidanceLines: string[] = [];
  if (sleepAvg < 6.2) {
    guidanceLines.push(G.guidance.sleep);
  }
  if (stressAvg >= 3.8) {
    guidanceLines.push(G.guidance.stress);
  }
  if (concAvg <= 3.0) {
    guidanceLines.push(G.guidance.conc);
  }
  if (planAvg < 60) {
    guidanceLines.push(G.guidance.plan);
  }
  if (!guidanceLines.length) {
    guidanceLines.push(G.guidance.default);
  }

  const suggestedPhrases: string[] =
    intervention === Iv.observe
      ? [...SP.observe]
      : intervention === Iv.praise
        ? [...SP.praise]
        : intervention === Iv.oneQuestion
          ? [...SP.oneQuestion]
          : intervention === Iv.routineHelp
            ? [...SP.routineHelp]
            : [...SP.counseling];

  return {
    urgency,
    headline,
    guidanceLines,
    suggestedPhrases,
    intervention
  };
}
