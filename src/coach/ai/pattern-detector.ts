import type { DailyLog, DetectedPattern, Severity } from "../types";

function sev(n: number): Severity {
  if (n >= 0.72) return "높음";
  if (n >= 0.42) return "보통";
  return "낮음";
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

  // 수면 적자
  {
    const score = clamp01(
      (sleepDeficit2d ? 0.55 : 0) + (6.6 - sleepAvg) / 1.6
    );
    if (score > 0.18) {
      patterns.push({
        key: "sleep_deficit",
        title: "수면 회복 부족",
        severity: sev(score),
        explanation:
          "최근 수면 시간이 누적되면서, ‘컨디션 저하 → 집중 하락’ 흐름이 만들어지고 있어요.",
        whyItMatters:
          "수면은 암기·문제풀이 모두에 영향을 줍니다. 특히 실수/멍함은 의지보다 회복 문제일 때가 많아요.",
        recommendation:
          "오늘은 공부량을 늘리기보다, ‘취침 시간을 20분만 당기기 + 첫 블록을 가볍게 시작’으로 회복 루틴을 만드세요."
      });
    }
  }

  // 식사 불규칙
  {
    const score = clamp01((3.7 - mealsAvg) / 2.2);
    if (score > 0.22) {
      patterns.push({
        key: "irregular_meals",
        title: "식사 리듬 흔들림",
        severity: sev(score),
        explanation:
          "식사가 들쭉날쭉하면 혈당·기분·에너지가 같이 흔들리면서 ‘집중의 바닥’이 낮아져요.",
        whyItMatters:
          "공부를 오래 해도 ‘잘 안 들어오는 느낌’이 커지고, 계획 실행률이 떨어지기 쉽습니다.",
        recommendation:
          "오늘은 완벽한 식단보다 ‘시간 고정’이 목표예요. 최소 1끼는 매일 같은 시간에 잡아주세요."
      });
    }
  }

  // 활동량 저하
  {
    const score = clamp01((5200 - stepsAvg) / 4200);
    if (score > 0.22) {
      patterns.push({
        key: "low_activity",
        title: "활동량 저하",
        severity: sev(score),
        explanation:
          "활동량이 낮아지면 각성 수준이 떨어져, ‘자리에 앉아도 집중이 안 되는’ 상태가 생겨요.",
        whyItMatters:
          "특히 저녁 시간대에 멍함이 올라오고, 스마트폰으로 회피하게 되기 쉽습니다.",
        recommendation:
          "공부 시작 전 8~10분만 빠르게 걷거나 계단을 오르세요. ‘각성만 올리는’ 목적이면 충분합니다."
      });
    }
  }

  // 스트레스 과부하
  {
    const score = clamp01((stressAvg - 3.1) / 1.6);
    if (score > 0.2) {
      patterns.push({
        key: "high_stress",
        title: "심리적 과부하",
        severity: sev(score),
        explanation:
          "스트레스가 높은 주에는 ‘계획 → 실행’이 끊기고, 작은 실패가 크게 느껴져요.",
        whyItMatters:
          "이때는 공부법을 바꾸기보다, 실행 진입장벽을 낮추는 게 성과가 빠릅니다.",
        recommendation:
          "오늘은 ‘25분 시작’만 성공 기준으로 잡고, 종료 후에만 다음 블록을 결정하세요."
      });
    }
  }

  // 집중 하락 + 스마트폰 방해
  {
    const score = clamp01((3.4 - concAvg) / 1.6 + (phoneAvg - 9) / 18);
    if (score > 0.28) {
      patterns.push({
        key: "falling_concentration",
        title: "집중도 하락 신호",
        severity: sev(score),
        explanation:
          "집중이 떨어진 날에는 스마트폰 방해가 같이 증가하는 경향이 보여요.",
        whyItMatters:
          "방해가 늘면 공부량을 늘릴수록 피로만 쌓이고, 자기효능감이 빠르게 떨어집니다.",
        recommendation:
          "첫 블록만 ‘핸드폰 시야 밖 + 타이머 25분’으로 고정하고, 쉬는 시간에만 확인하는 규칙을 잡아보세요."
      });
    }
  }

  // 계획-실행 갭
  {
    const score = clamp01((60 - planAvg) / 35);
    if (score > 0.25) {
      patterns.push({
        key: "plan_execution_gap",
        title: "계획-실행 갭",
        severity: sev(score),
        explanation:
          "계획을 ‘잘 세우는 것’과 ‘실제로 시작하는 것’ 사이에 작은 마찰이 쌓여 있어요.",
        whyItMatters:
          "이 패턴이 굳어지면 ‘계획은 많은데 성과는 부족’한 슬럼프가 빨리 옵니다.",
        recommendation:
          "오늘은 할 일을 3개로 줄이고, ‘첫 1개는 10분짜리’로 쪼개서 시작만 빠르게 만들어보세요."
      });
    }
  }

  return patterns;
}

