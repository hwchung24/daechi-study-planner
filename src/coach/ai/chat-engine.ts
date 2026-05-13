import type { CoachMessage, DailyLog, StudentProfile, WeeklyInsight } from "../types";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

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
  const L = ko.localDemoCoach;

  const main = insight.patterns[0];
  const risk = insight.riskLevel;
  const cause =
    main?.key === "sleep_deficit"
      ? L.causeSleep
      : main?.key === "plan_execution_gap"
        ? L.causePlan
        : main?.key === "high_stress"
          ? L.causeStress
          : main?.key === "falling_concentration"
            ? L.causeConc
            : L.causeDefault;

  const priorities = [
    insight.nextActions[0]?.title || L.priorityDefault1,
    insight.nextActions[1]?.title || L.priorityDefault2,
    `${pick(student.targetSubjects)}${L.prioritySubjectSuffix}`
  ].filter(Boolean);

  const tips = [
    L.tip1,
    L.tip2,
    risk === "높음" ? L.tipRiskHigh : L.tipRiskLow
  ];

  const encouragement = pick([L.enc1, L.enc2, L.enc3]);

  const structuredData = {
    cause,
    priorities: priorities.slice(0, 3),
    tips: tips.slice(0, 3),
    encouragement
  };

  const header =
    t.includes("집중") || t.includes("왜")
      ? L.headerFocus
      : t.includes("내일")
        ? L.headerTomorrow
        : L.headerDefault;

  const text = [
    `${header} ${structuredData.cause}.`,
    tpl(L.todayPrioritiesLine, {
      priorities: structuredData.priorities.slice(0, 2).join(", ")
    }),
    `${structuredData.tips[0]} ${structuredData.tips[1]}`,
    structuredData.encouragement
  ].join("\n\n");

  const last = logs7d[logs7d.length - 1];
  const extra =
    last && last.sleepHours < 6
      ? L.extraSleep
      : last && last.phoneDistractions >= 14
        ? L.extraPhone
        : "";

  console.log("[AI코치] userText:", t);
  if (t.includes("일정")) {
    return {
      id: nowId(),
      role: "coach",
      createdAt: Date.now(),
      text: L.scheduleReply,
      structured: { type: "schedule_inquiry" }
    };
  }

  return {
    id: nowId(),
    role: "coach",
    createdAt: Date.now(),
    text: text + extra,
    structured: structuredData
  };
}
