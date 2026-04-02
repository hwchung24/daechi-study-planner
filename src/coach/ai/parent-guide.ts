import type { DailyLog, Severity, WeeklyInsight } from "../types";

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export type ParentGuide = {
  urgency: Severity;
  headline: string;
  guidanceLines: string[];
  suggestedPhrases: string[];
  intervention: "관찰" | "칭찬" | "질문 1개" | "루틴 도움" | "상담 권장";
};

export function buildParentGuide(insight: WeeklyInsight, logs7d: DailyLog[]): ParentGuide {
  const concAvg = avg(logs7d.map(l => l.concentrationScore));
  const stressAvg = avg(logs7d.map(l => l.stressScore));
  const sleepAvg = avg(logs7d.map(l => l.sleepHours));
  const planAvg = avg(logs7d.map(l => l.planCompletionRate));

  const urgency = insight.riskLevel;

  const intervention: ParentGuide["intervention"] =
    urgency === "높음"
      ? stressAvg >= 4.0
        ? "상담 권장"
        : "루틴 도움"
      : urgency === "보통"
        ? planAvg < 60
          ? "질문 1개"
          : "칭찬"
        : "관찰";

  const headline =
    urgency === "높음"
      ? "잔소리 대신, 회복을 돕는 타이밍입니다"
      : urgency === "보통"
        ? "조언보다 ‘환경 조정’이 효과적인 구간이에요"
        : "지금은 관찰하며 칭찬을 쌓기 좋아요";

  const guidanceLines: string[] = [];
  if (sleepAvg < 6.2) {
    guidanceLines.push("수면이 줄어들면 의욕보다 ‘컨디션’이 먼저 무너집니다. 오늘은 취침 시간을 20분만 당겨도 충분해요.");
  }
  if (stressAvg >= 3.8) {
    guidanceLines.push("압박이 높을수록 ‘왜 안 하니’는 역효과가 납니다. 결과보다 ‘앉아 있었던 시간’ 같은 과정 칭찬을 먼저 주세요.");
  }
  if (concAvg <= 3.0) {
    guidanceLines.push("집중이 떨어질 때는 긴 조언보다 ‘첫 25분 시작’을 도와주는 게 효과적입니다.");
  }
  if (planAvg < 60) {
    guidanceLines.push("계획 실행률이 낮으면 계획을 더 세우게 하기보다 ‘오늘 할 일을 3개로 줄이는’ 결정을 함께 해주세요.");
  }
  if (!guidanceLines.length) {
    guidanceLines.push("큰 개입 없이도 흐름이 유지되고 있어요. 다만 주말 리듬이 흔들리지 않도록 가볍게 확인해 주세요.");
  }

  const suggestedPhrases: string[] = [];
  if (intervention === "관찰") {
    suggestedPhrases.push("오늘은 네가 스스로 관리하는 걸 믿고 지켜볼게. 필요하면 언제든 말해줘.");
    suggestedPhrases.push("오늘 공부량보다 ‘시작한 것’ 자체가 좋아. 그 흐름 유지해보자.");
  } else if (intervention === "칭찬") {
    suggestedPhrases.push("결과보다, 오늘 꾸준히 앉아있던 게 정말 대단해.");
    suggestedPhrases.push("너무 완벽하려고 하지 말고, 오늘은 잘 한 것만 하나 말해줄래?");
  } else if (intervention === "질문 1개") {
    suggestedPhrases.push("오늘 계획이 실행이 안 됐다면, 시작을 막은 ‘한 가지’가 뭐였어?");
    suggestedPhrases.push("내일은 첫 25분을 더 쉽게 만들려면 무엇을 바꾸면 좋을까?");
  } else if (intervention === "루틴 도움") {
    suggestedPhrases.push("오늘은 조언보다 환경을 먼저 도와줄게. 시작하기 편하게 책상만 같이 정리할까?");
    suggestedPhrases.push("오늘 목표는 딱 25분 시작만 하자. 나머지는 네가 결정해도 돼.");
  } else {
    suggestedPhrases.push("요즘 힘든 신호가 보여. 혼자 버티기보다, 코치/상담을 같이 연결해보는 건 어때?");
    suggestedPhrases.push("너를 통제하려는 게 아니라, 회복을 돕고 싶어. 무엇이 제일 부담돼?");
  }

  return {
    urgency,
    headline,
    guidanceLines,
    suggestedPhrases,
    intervention
  };
}

