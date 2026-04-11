import type { DailyLog, ParentProfile, StudentProfile, StudySession } from "./types";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateKeyFromToday(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}

export const demoStudents: StudentProfile[] = [
  {
    id: "stu_hyeon",
    name: "현우",
    schoolLevel: "고",
    grade: 2,
    targetSubjects: ["수학", "영어", "국어"],
    weakSubjects: ["영어"],
    goal: "모의고사 2등급 → 1등급 안정화",
    typicalSleepTime: "00:30",
    typicalWakeTime: "07:10",
    examSchedule: [
      { date: dateKeyFromToday(12), title: "3월 모의고사" },
      { date: dateKeyFromToday(-19), title: "중간고사" }
    ]
  },
  {
    id: "stu_min",
    name: "민지",
    schoolLevel: "중",
    grade: 3,
    targetSubjects: ["수학", "과학", "영어"],
    weakSubjects: ["수학"],
    goal: "수학 서술형 실수 줄이기",
    typicalSleepTime: "23:40",
    typicalWakeTime: "06:50",
    examSchedule: [{ date: dateKeyFromToday(-25), title: "기말고사" }]
  },
  {
    id: "stu_joon",
    name: "준서",
    schoolLevel: "고",
    grade: 1,
    targetSubjects: ["수학", "통합과학", "영어"],
    weakSubjects: ["통합과학"],
    goal: "루틴 고정 + 복습 타이밍 만들기",
    typicalSleepTime: "01:10",
    typicalWakeTime: "07:30",
    examSchedule: [{ date: dateKeyFromToday(-10), title: "학력평가" }]
  }
];

export const demoParents: ParentProfile[] = [
  {
    id: "par_soyoon",
    name: "소윤",
    relationship: "엄마",
    childStudentId: "stu_hyeon",
    childName: "현우"
  },
  {
    id: "par_dongho",
    name: "동호",
    relationship: "아빠",
    childStudentId: "stu_min",
    childName: "민지"
  }
];

export const demoDailyLogs: DailyLog[] = (() => {
  const out: DailyLog[] = [];
  const mk = (studentId: string, i: number, partial: Partial<DailyLog>) => {
    const date = dateKeyFromToday(i);
    out.push({
      id: `${studentId}_${date}`,
      studentId,
      date,
      sleepHours: 6.5,
      wakeCondition: 3,
      mealsRegularity: 3,
      steps: 4200,
      totalStudyMinutes: 260,
      concentrationScore: 3,
      stressScore: 3,
      phoneDistractions: 9,
      planCompletionRate: 62,
      ...partial
    });
  };

  for (let i = 29; i >= 0; i--) {
    // 현우: 주말 리듬 흔들림 + 수면 적자 구간
    mk("stu_hyeon", i, {
      sleepHours: i % 7 === 0 ? 5.3 : i % 6 === 0 ? 5.8 : 6.6,
      mealsRegularity: i % 5 === 0 ? 2 : 4,
      steps: i % 4 === 0 ? 1800 : 5200,
      concentrationScore: i % 6 === 0 ? 2 : i % 5 === 0 ? 3 : 4,
      stressScore: i % 6 === 0 ? 4 : 3,
      totalStudyMinutes: i % 6 === 0 ? 210 : i % 3 === 0 ? 320 : 280,
      phoneDistractions: i % 6 === 0 ? 17 : 8,
      planCompletionRate: i % 6 === 0 ? 48 : 68,
      reflectionMemo:
        i % 6 === 0
          ? "계획은 했는데 시작이 늦어져서 밀렸음."
          : i % 5 === 0
            ? "영어는 했는데 복습을 못함."
            : undefined
    });

    // 민지: 스트레스/실수형, 계획 대비 실행 갭
    mk("stu_min", i, {
      sleepHours: i % 8 === 0 ? 6.0 : 7.1,
      steps: i % 3 === 0 ? 2600 : 6400,
      mealsRegularity: 4,
      concentrationScore: i % 7 === 0 ? 2 : 3,
      stressScore: i % 7 === 0 ? 5 : 3,
      totalStudyMinutes: i % 4 === 0 ? 180 : 240,
      phoneDistractions: i % 7 === 0 ? 15 : 6,
      planCompletionRate: i % 7 === 0 ? 44 : 58,
      reflectionMemo:
        i % 7 === 0
          ? "문제는 풀었는데 서술형에서 자꾸 틀림."
          : undefined
    });

    // 준서: 복습 지연 + 주말 루틴
    mk("stu_joon", i, {
      sleepHours: i % 7 === 0 ? 5.9 : 6.8,
      mealsRegularity: i % 6 === 0 ? 2 : 3,
      steps: i % 5 === 0 ? 2300 : 4800,
      concentrationScore: i % 5 === 0 ? 2 : 3,
      stressScore: i % 5 === 0 ? 4 : 3,
      totalStudyMinutes: i % 5 === 0 ? 200 : 260,
      phoneDistractions: i % 5 === 0 ? 14 : 9,
      planCompletionRate: i % 5 === 0 ? 52 : 66
    });
  }

  return out;
})();

export const demoStudySessions: StudySession[] = (() => {
  const out: StudySession[] = [];
  const sessions = [
    { subject: "수학", plannedMinutes: 60 },
    { subject: "영어", plannedMinutes: 40 },
    { subject: "국어", plannedMinutes: 35 },
    { subject: "과학", plannedMinutes: 45 }
  ];

  for (let i = 14; i >= 0; i--) {
    const date = dateKeyFromToday(i);
    for (const s of sessions) {
      const base = s.plannedMinutes;
      const jitter = (i % 3) * 6;
      out.push({
        id: `sess_${date}_${s.subject}_${i}`,
        studentId: i % 2 === 0 ? "stu_hyeon" : "stu_min",
        date,
        subject: s.subject,
        startTime: "19:00",
        endTime: "20:00",
        plannedMinutes: base,
        actualMinutes: Math.max(15, base - jitter),
        focusScore: i % 5 === 0 ? 2 : 4,
        completed: i % 6 !== 0
      });
    }
  }
  return out;
})();

export const demoTestimonials = [
  {
    id: "t1",
    name: "고2 학생 (데모)",
    quote:
      "‘의지 문제’라고만 생각했는데, 수면·식사·시작 지연이 같이 흔들린다는 걸 처음 체감했어요."
  },
  {
    id: "t2",
    name: "관리자 (데모)",
    quote:
      "무작정 잔소리하기 전에 ‘오늘은 관찰만’ 같은 가이드가 있으니 대화가 훨씬 부드러워졌어요."
  },
  {
    id: "t3",
    name: "중3 학생 (데모)",
    quote: "다음 행동을 1개로 좁혀주니까, 시작이 빨라졌습니다."
  }
] as const;

