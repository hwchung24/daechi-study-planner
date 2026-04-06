export type CoachRole = "student" | "parent" | "admin";

export type Severity = "낮음" | "보통" | "높음";

export type StudentProfile = {
  id: string;
  name: string;
  schoolLevel: "중" | "고";
  grade: number;
  targetSubjects: string[];
  weakSubjects: string[];
  goal: string;
  typicalSleepTime: string; // "23:30"
  typicalWakeTime: string; // "06:30"
  examSchedule: Array<{ date: string; title: string }>;
};

export type ParentProfile = {
  id: string;
  name: string;
  relationship: "엄마" | "아빠" | "보호자";
  childStudentId: string;
  childName: string;
};

export type DailyLog = {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  sleepHours: number;
  wakeCondition: 1 | 2 | 3 | 4 | 5; // 5 best
  mealsRegularity: 1 | 2 | 3 | 4 | 5;
  steps: number;
  totalStudyMinutes: number;
  concentrationScore: 1 | 2 | 3 | 4 | 5;
  stressScore: 1 | 2 | 3 | 4 | 5; // 5 high stress
  phoneDistractions: number;
  planCompletionRate: number; // 0..100
  reflectionMemo?: string;
};

export type StudySession = {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  subject: string;
  startTime: string; // "19:00"
  endTime: string; // "20:10"
  plannedMinutes: number;
  actualMinutes: number;
  focusScore: 1 | 2 | 3 | 4 | 5;
  completed: boolean;
};

export type DetectedPattern = {
  key:
    | "sleep_deficit"
    | "weekend_rhythm"
    | "irregular_meals"
    | "low_activity"
    | "high_stress"
    | "falling_concentration"
    | "delayed_start"
    | "plan_execution_gap"
    | "review_delay";
  title: string;
  severity: Severity;
  explanation: string;
  whyItMatters: string;
  recommendation: string;
};

export type NextAction = {
  id: string;
  title: string;
  detail?: string;
  tag?: "루틴" | "집중" | "복습" | "수면" | "스트레스";
};

export type WeeklyInsight = {
  studentId: string;
  weekStartDate: string; // YYYY-MM-DD
  summarySentence: string;
  riskLevel: Severity;
  heroNarrative: string;
  metrics7d: Array<{
    date: string;
    concentration: number; // 0..100
    studyMinutes: number;
    sleepHours: number;
    stressScore: number; // 1..5
    planCompletionRate: number; // 0..100
  }>;
  patterns: DetectedPattern[];
  nextActions: NextAction[];
};

export type CoachMessage = {
  id: string;
  role: "user" | "coach";
  createdAt: number;
  text: string;
  structured?:
    | {
        cause: string;
        priorities: string[];
        tips: string[];
        encouragement: string;
      }
    | {
        type: "schedule_inquiry";
      }
    | undefined;
};

