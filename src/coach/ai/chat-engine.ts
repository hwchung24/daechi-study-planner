import type { CoachMessage, DailyLog, StudentProfile, WeeklyInsight } from "../types";

function nowId() {
  return `m_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pick<T>(xs: T[]) {
  return xs[Math.floor(Math.random() * xs.length)];
}

export function generateCoachReply(args: {
  student: StudentProfile;
  insight: WeeklyInsight;
  logs7d: DailyLog[];
  userText: string;
}): CoachMessage {
  const { student, insight, logs7d, userText } = args;
  const t = userText.trim();

  const main = insight.patterns[0];
  const risk = insight.riskLevel;
  const cause =
    main?.key === "sleep_deficit"
      ? "수면 회복이 부족해서, 집중의 바닥이 내려간 상태"
      : main?.key === "plan_execution_gap"
        ? "계획은 세우지만 시작 진입장벽이 높아 실행이 밀리는 상태"
        : main?.key === "high_stress"
          ? "심리적 압박이 커서 ‘회피 → 미루기’로 흐름이 끊기는 상태"
          : main?.key === "falling_concentration"
            ? "집중도 하락과 스마트폰 방해가 함께 올라오는 상태"
            : "생활 리듬과 학습 루틴이 함께 흔들리는 상태";

  const priorities = [
    insight.nextActions[0]?.title || "첫 25분을 가볍게 시작하기",
    insight.nextActions[1]?.title || "오늘 할 일을 3개로 줄이기",
    `${pick(student.targetSubjects)} 20분 복습 먼저 하기`
  ].filter(Boolean);

  const tips = [
    "‘시작’만 빨라지면 뒤는 자동으로 따라오는 경우가 많아요.",
    "완벽한 하루를 만들기보다, 3일 연속으로 유지할 수 있는 규칙을 고르세요.",
    risk === "높음"
      ? "오늘은 양보다 회복이 우선입니다. 공부량은 ‘최소 유지’가 목표예요."
      : "오늘은 작은 성공을 쌓는 날로 잡아봅시다."
  ];

  const encouragement = pick([
    "지금 느끼는 답답함은 ‘의지 부족’이 아니라 ‘시스템 피로’일 가능성이 큽니다. 다시 만들 수 있어요.",
    "오늘 25분만 시작해도 충분합니다. 흐름은 ‘작은 성공’에서 다시 살아나요.",
    "지금까지 버틴 것도 실력입니다. 오늘은 회복과 실행을 동시에 잡아봅시다."
  ]);

  const structured = {
    cause,
    priorities: priorities.slice(0, 3),
    tips: tips.slice(0, 3),
    encouragement
  };

  const header =
    t.includes("집중") || t.includes("왜")
      ? "원인을 먼저 정리해볼게요."
      : t.includes("내일")
        ? "내일은 ‘시작을 쉽게’ 만드는 계획이 핵심이에요."
        : "좋아요. 지금 상황 기준으로 바로 실행 가능한 답을 드릴게요.";

  const text = [
    header,
    "",
    "1) 원인 분석",
    `- ${structured.cause}`,
    "",
    "2) 오늘의 우선순위",
    ...structured.priorities.map(p => `- ${p}`),
    "",
    "3) 실행 팁",
    ...structured.tips.map(p => `- ${p}`),
    "",
    "4) 격려 한 줄",
    `- ${structured.encouragement}`
  ].join("\n");

  // 로그 기반 약간의 개인화(텍스트에 반영)
  const last = logs7d[logs7d.length - 1];
  const extra =
    last && last.sleepHours < 6
      ? "\n\n추가로, 어제/오늘 수면이 짧아서 ‘멍함’이 더 크게 느껴질 수 있어요. 오늘은 20분만 당겨도 체감이 납니다."
      : last && last.phoneDistractions >= 14
        ? "\n\n추가로, 방해(폰)가 많았던 날이에요. 첫 블록만 ‘시야 밖’ 규칙을 걸어보세요."
        : "";

  return {
    id: nowId(),
    role: "coach",
    createdAt: Date.now(),
    text: text + extra,
    structured
  };
}

