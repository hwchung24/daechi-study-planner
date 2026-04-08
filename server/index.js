const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const OpenAI = require("openai");

const {
  findUserByEmail,
  createUser,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData,
  getStudyPlansForDate,
  listStudyBooks,
  createStudyBook,
  softDeleteStudyBook,
  getMe,
  getUserByIdForAuth,
  updateUserEmail,
  updateUserPasswordHash,
  listParentStudents,
  listLinkedParentUserIdsForStudent,
  listStudentParents,
  parentRequestLink,
  studentRequestParent,
  listParentLinkRequests,
  listStudentLinkRequests,
  studentConfirmLinkRequest,
  parentConfirmLinkRequest,
  rejectLinkRequest,
  parentHasStudent,
  countLinkedParentsForStudent,
  getActiveStudyBookForStudent,
  createParentPlanAddRequest,
  listPendingPlanAddRequestsForParent,
  approvePlanAddRequestByParent,
  rejectPlanAddRequestByParent,
  getLatestParentAiReport,
  ensureConnected,
  createWebclipSession,
  consumeWebclipSession,
  linkDeviceToUserBySerial,
  getActiveDeviceSerialForUser,
  getParentPlannerRule,
  upsertParentPlannerRule,
  listStoreAppsForUser,
  getStoreAppByKey,
  updateStoreAppSimpleMdmId,
  setStoreAppInstalled,
  getStudentMdmGroup,
  upsertStudentMdmGroup,
  upsertStudentCoachProfile,
  getStudentCoachProfile,
  insertStudentCoachLog,
  upsertStudentCoachLog,
  setStudentCoachLogTomorrowPractice,
  setStudentCoachLogTomorrowPracticeDone,
  listRecentStudentCoachLogs,
  listStudentCoachLogsInWeekRange,
  insertStudentCoachMessage,
  listRecentStudentCoachMessages,
  listStudentProfileSchedules,
  createStudentProfileSchedule,
  updateStudentProfileSchedule,
  cancelStudentProfileScheduleOccurrence,
  deleteStudentProfileSchedule,
  countUnreadStudentNotifications,
  listStudentNotifications,
  markStudentNotificationsReadAll,
  countUnreadParentNotifications,
  listParentNotifications,
  markParentNotificationsReadAll,
  createParentNotificationForLinkedParents,
  deleteUser
} = require("./db");
const {
  computeWeeklyStats,
  buildWeeklySummaryLines
} = require("./analytics");
const { startDailyAiReportCron } = require("./dailyReportCron");
const { startPlannerLockCron } = require("./plannerLockCron");
const { runOnePair } = require("./aiReportService");
const {
  getStudentLockStatus,
  assertStudentCanEditDate,
  forceParentLock,
  forceParentUnlock,
  getParentLockStatus,
  reconcileAllPlannerLocks
} = require("./lockService");
const {
  isSimpleMdmConfigured,
  findDeviceBySerial,
  findAppByBundleIdOrName,
  listInstalledAppsForDevice,
  findInstalledAppForDevice,
  createAppInCatalog,
  createAssignmentGroup,
  assignAppToGroup,
  unassignAppFromGroup,
  uninstallInstalledApp,
  assignDeviceToGroup,
  pushApps,
  pushAssignedAppsToDevice,
  refreshDevice
} = require("./simpleMdmClient");

const JWT_SECRET = String(process.env.JWT_SECRET || "");
const PORT = process.env.PORT || 3000;
const WEB_APP_URL =
  (process.env.WEB_APP_URL || "http://localhost:5173").replace(/\/+$/, "");
const WEBCLIP_COOKIE_NAME = "daechi_device_session";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
let dbConnected = false;
let cronStarted = false;
let schemaApplied = false;

function assertRuntimeConfig() {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && JWT_SECRET.length < 24) {
    throw new Error(
      "JWT_SECRET must be set to a strong value (24+ chars) in production."
    );
  }
}

const app = express();
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
if (process.env.NODE_ENV !== "test") {
  console.log(
    openai
      ? `[openai] ready (coach chat + reports), model=${OPENAI_MODEL}`
      : "[openai] OPENAI_API_KEY 없음 — 코치 채팅은 규칙 기반 템플릿, 일일 AI 리포트는 생략"
  );
  if (!isSimpleMdmConfigured()) {
    console.warn(
      "[simplemdm] SIMPLEMDM_API_KEY 없음 — 학생 학습 앱스토어 설치/삭제 기능은 동작하지 않습니다."
    );
  }
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + Number(b || 0), 0) / arr.length;
}

function buildCoachSnapshot(profile, logs = []) {
  const recent = [...logs].slice(0, 7);
  const sleep = avg(recent.map(r => Number(r.sleep_hours)));
  const conc = avg(recent.map(r => Number(r.concentration_score)));
  const stress = avg(recent.map(r => Number(r.stress_score)));
  const steps = avg(recent.map(r => Number(r.steps)));
  const plan = avg(recent.map(r => Number(r.plan_completion_rate)));
  const study = avg(recent.map(r => Number(r.study_minutes)));
  const meals = avg(recent.map(r => Number(r.meals_regularity)));

  let hero = "현재 학습 흐름은 유지되고 있어요. 오늘은 우선순위 1개부터 시작해보세요.";
  if (sleep > 0 && sleep < 6.2 && conc > 0 && conc < 3.2) {
    hero = "단순 의지 문제가 아니라 수면 회복 부족이 집중 저하로 이어지고 있어요.";
  } else if (stress >= 3.8) {
    hero = "최근에는 스트레스 과부하 신호가 보여요. 계획보다 실행 진입장벽을 낮추는 게 먼저예요.";
  } else if (plan > 0 && plan < 60) {
    hero = "계획 대비 실행률이 낮아요. 할 일을 줄이고 시작 마찰을 없애는 게 핵심입니다.";
  } else if (steps > 0 && steps < 3000) {
    hero = "활동량이 낮아 집중 각성이 떨어질 수 있어요. 공부 전 짧은 걷기가 도움이 됩니다.";
  }

  const nextActions = [
    "첫 블록은 25분만 시작하기",
    "오늘 할 일을 3개로 줄이기",
    "핸드폰은 첫 블록 동안 시야 밖에 두기"
  ];
  if (sleep > 0 && sleep < 6.2) nextActions[0] = "취침 시간을 20분만 당기기";
  if (plan > 0 && plan < 60) nextActions[1] = "실행률이 낮은 과목 1개만 먼저 시작하기";
  if (stress >= 3.8) nextActions[2] = "오늘 목표를 ‘완료’보다 ‘시작’으로 재설정하기";

  return {
    profile: {
      name: profile?.name || "학생",
      schoolLevel: profile?.school_level || null,
      grade: profile?.grade || null,
      goal: profile?.goal || "",
      targetSubjects: profile?.target_subjects || [],
      weakSubjects: profile?.weak_subjects || []
    },
    heroNarrative: hero,
    metrics: {
      sleepHours: sleep || null,
      concentration: conc || null,
      stress: stress || null,
      steps: steps || null,
      planCompletionRate: plan || null,
      studyMinutes: study || null,
      mealsRegularity: meals || null
    },
    nextActions
  };
}

/** 순간 → 서울 달력 YYYY-MM-DD (pg DATE가 JS Date로 올 때 UTC일자와 어긋나는 것 방지) */
function formatYmdSeoulFromInstant(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);
    const y = parts.find(p => p.type === "year")?.value;
    const mo = parts.find(p => p.type === "month")?.value;
    const day = parts.find(p => p.type === "day")?.value;
    if (y && mo && day) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  } catch {
    // ignore
  }
  const u = new Date(d.getTime() + 9 * 3600000);
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(
    u.getUTCDate()
  ).padStart(2, "0")}`;
}

function addDaysToSeoulDateKey(isoKey, delta) {
  const anchor = new Date(`${isoKey}T12:00:00+09:00`);
  const next = new Date(anchor.getTime() + delta * 86400000);
  return formatYmdSeoulFromInstant(next);
}

function weekdayMon0FromIsoDate(isoKey) {
  const m = String(isoKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (utc.getUTCDay() + 6) % 7;
}

function getKoreanWeekdayNameFromIsoDate(isoKey) {
  const names = ["월", "화", "수", "목", "금", "토", "일"];
  const idx = weekdayMon0FromIsoDate(isoKey);
  return names[idx] || "";
}

/** 서울 달력 이번 주 월요일 키 (offsetWeeks: 0=이번 주) — 클라이언트 getWeekStartKeySeoul과 동일 로직 */
function getWeekStartKeySeoul(offsetWeeks = 0) {
  const todayKey = formatYmdSeoulFromInstant(new Date());
  let mondayKey = todayKey;
  for (let back = 0; back < 7; back++) {
    const key = addDaysToSeoulDateKey(todayKey, -back);
    if (weekdayMon0FromIsoDate(key) === 0) {
      mondayKey = key;
      break;
    }
  }
  return addDaysToSeoulDateKey(mondayKey, -7 * offsetWeeks);
}

function getWeekDayKeysSeoul(offsetWeeks = 0) {
  const monday = getWeekStartKeySeoul(offsetWeeks);
  const keys = [];
  for (let i = 0; i < 7; i++) {
    keys.push(addDaysToSeoulDateKey(monday, i));
  }
  return keys;
}

/** Postgres DATE / JSON 직렬화 ISO 문자열 → 앱 기준(서울) YYYY-MM-DD */
function formatPgLogDate(v) {
  if (v == null) return "";
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(s)) {
      return formatYmdSeoulFromInstant(d);
    }
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : "";
  }
  const d = v instanceof Date ? v : new Date(v);
  return formatYmdSeoulFromInstant(d);
}

/** 클라이언트가 보낸 이번 주 월요일(YYYY-MM-DD) 기준 7일 키 — 서버 TZ와 무관 */
function getWeekKeysFromMonday(mondayIso) {
  const parts = String(mondayIso || "")
    .trim()
    .split("-")
    .map(Number);
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return getWeekDayKeysSeoul(0);
  }
  const keys = [];
  for (let i = 0; i < 7; i++) {
    const t = new Date(Date.UTC(y, mo - 1, d + i));
    keys.push(
      `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
        t.getUTCDate()
      ).padStart(2, "0")}`
    );
  }
  return keys;
}

/** student_coach_logs 행들 → 그래프와 동일한 이번 주 7일 시계열 */
function buildWeekRhythmPayloadFromLogs(logRows, weekMondayIso = null) {
  const weekKeys =
    weekMondayIso && isIsoDate(weekMondayIso)
      ? getWeekKeysFromMonday(weekMondayIso)
      : getWeekDayKeysSeoul(0);
  const byDate = new Map();
  for (const r of logRows || []) {
    const k = formatPgLogDate(r.log_date);
    if (k && !byDate.has(k)) byDate.set(k, r);
  }
  return weekKeys.map(dateKey => {
    const r = byDate.get(dateKey);
    if (!r) {
      return {
        date: dateKey,
        sleepHours: null,
        stressScore: null,
        concentrationScore: null,
        concentrationPercent: null,
        studyMinutes: null,
        planCompletionRate: null,
        steps: null,
        mealsRegularity: null
      };
    }
    const concNum =
      r.concentration_score != null &&
      Number.isFinite(Number(r.concentration_score))
        ? Number(r.concentration_score)
        : null;
    return {
      date: dateKey,
      sleepHours:
        r.sleep_hours != null && Number.isFinite(Number(r.sleep_hours))
          ? Number(r.sleep_hours)
          : null,
      stressScore:
        r.stress_score != null && Number.isFinite(Number(r.stress_score))
          ? Number(r.stress_score)
          : null,
      concentrationScore: concNum,
      concentrationPercent:
        concNum == null ? null : Math.round((concNum / 5) * 100),
      studyMinutes:
        r.study_minutes != null && Number.isFinite(Number(r.study_minutes))
          ? Number(r.study_minutes)
          : null,
      planCompletionRate:
        r.plan_completion_rate != null &&
        Number.isFinite(Number(r.plan_completion_rate))
          ? Number(r.plan_completion_rate)
          : null,
      steps:
        r.steps != null && Number.isFinite(Number(r.steps))
          ? Number(r.steps)
          : null,
      mealsRegularity:
        r.meals_regularity != null &&
        Number.isFinite(Number(r.meals_regularity))
          ? Number(r.meals_regularity)
          : null
    };
  });
}

function normalizePatternSeverity(s) {
  const t = String(s || "").trim();
  if (t === "높음" || t === "보통" || t === "낮음") return t;
  return "보통";
}

function sanitizeAiPatterns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 6)
    .map((p, i) => {
      const title = String(p?.title || "").trim().slice(0, 80);
      const explanation = String(p?.explanation || "").trim().slice(0, 500);
      const recommendation = String(p?.recommendation || "").trim().slice(0, 500);
      if (!title || !explanation) return null;
      return {
        key: `ai_pat_${i}`,
        title,
        severity: normalizePatternSeverity(p?.severity),
        explanation,
        recommendation:
          recommendation || "하루 한 가지 작은 루틴부터 조정해 보세요."
      };
    })
    .filter(Boolean);
}

function hasAnyRhythmMetric(row) {
  return (
    row?.sleepHours != null ||
    row?.stressScore != null ||
    row?.concentrationPercent != null ||
    row?.studyMinutes != null ||
    row?.planCompletionRate != null
  );
}

function looksLikeInsufficientPattern(p) {
  const t = `${String(p?.title || "")} ${String(p?.explanation || "")}`;
  return /(기록\s*부족|데이터\s*부족|분석\s*불가|분석이\s*어렵|판단이\s*어렵|기록이\s*더\s*필요)/.test(
    t
  );
}

function shortDateLabel(isoDate) {
  const s = String(isoDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s;
}

function buildRhythmFallbackPattern(rhythmWeek, recordedDays) {
  if (recordedDays < 2) {
    return {
      key: "ai_pat_0",
      title: "기록이 더 필요해요",
      severity: "낮음",
      explanation:
        "이번 주에 입력된 날이 적어요. 오늘 공부 탭에서 하루 기록을 쌓으면 그래프·AI 분석이 정확해져요.",
      recommendation:
        "수면·스트레스·집중·공부 시간·목표 달성률을 같은 날에 저장해 두면 한 주 흐름을 보기 좋아요."
    };
  }

  const rows = Array.isArray(rhythmWeek) ? rhythmWeek.filter(hasAnyRhythmMetric) : [];
  if (rows.length < 2) {
    return {
      key: "ai_pat_0",
      title: "패턴 요약",
      severity: "낮음",
      explanation:
        "이틀 이상 기록은 있지만 지표가 서로 다른 날에 흩어져 있어 직접 비교가 어려워요.",
      recommendation:
        "같은 날에 수면·스트레스·집중·공부 시간·목표 달성률을 함께 기록해 주세요."
    };
  }

  const prev = rows[rows.length - 2];
  const curr = rows[rows.length - 1];
  const positive = [];
  const negative = [];

  if (prev.sleepHours != null && curr.sleepHours != null) {
    const d = curr.sleepHours - prev.sleepHours;
    if (d >= 0.8) positive.push(`수면시간이 ${d.toFixed(1)}시간 늘었어요`);
    else if (d <= -0.8) negative.push(`수면시간이 ${Math.abs(d).toFixed(1)}시간 줄었어요`);
  }
  if (prev.stressScore != null && curr.stressScore != null) {
    const d = curr.stressScore - prev.stressScore;
    if (d <= -0.6) positive.push(`스트레스 점수가 ${Math.abs(d).toFixed(1)}점 낮아졌어요`);
    else if (d >= 0.6) negative.push(`스트레스 점수가 ${d.toFixed(1)}점 높아졌어요`);
  }
  if (prev.concentrationPercent != null && curr.concentrationPercent != null) {
    const d = curr.concentrationPercent - prev.concentrationPercent;
    if (d >= 8) positive.push(`집중도가 ${Math.round(d)}% 올랐어요`);
    else if (d <= -8) negative.push(`집중도가 ${Math.round(Math.abs(d))}% 떨어졌어요`);
  }
  if (prev.studyMinutes != null && curr.studyMinutes != null) {
    const d = curr.studyMinutes - prev.studyMinutes;
    if (d >= 30) positive.push(`공부시간이 ${Math.round(d)}분 늘었어요`);
    else if (d <= -30) negative.push(`공부시간이 ${Math.round(Math.abs(d))}분 줄었어요`);
  }
  if (prev.planCompletionRate != null && curr.planCompletionRate != null) {
    const d = curr.planCompletionRate - prev.planCompletionRate;
    if (d >= 10) positive.push(`목표 달성률이 ${Math.round(d)}%p 올랐어요`);
    else if (d <= -10) negative.push(`목표 달성률이 ${Math.round(Math.abs(d))}%p 내려갔어요`);
  }

  const compareLabel = `${shortDateLabel(prev.date)} 대비 ${shortDateLabel(curr.date)}`;
  const summaryParts = [];
  if (positive.length) summaryParts.push(`좋아진 신호: ${positive.slice(0, 2).join(", ")}`);
  if (negative.length) summaryParts.push(`주의 신호: ${negative.slice(0, 2).join(", ")}`);
  if (!summaryParts.length) {
    summaryParts.push("확인 가능한 지표는 큰 변화 없이 비슷한 흐름을 보였어요");
  }

  let recommendation = "내일도 같은 5개 지표를 같은 시간대에 기록해 변화 방향을 더 선명하게 확인해 보세요.";
  if (negative.some(s => s.includes("수면시간"))) {
    recommendation = "취침 시간을 30분만 앞당겨 수면시간을 먼저 회복해 보세요. 수면이 안정되면 집중도와 공부시간이 같이 회복될 가능성이 커요.";
  } else if (negative.some(s => s.includes("스트레스"))) {
    recommendation = "학습 시작 전 5분 호흡 정리나 쉬운 과목 워밍업을 넣어 스트레스 상승 구간을 낮춰 보세요.";
  } else if (negative.some(s => s.includes("집중도"))) {
    recommendation = "첫 25분은 알림 차단 + 단일 과목으로 시작해 집중도 하락 구간을 줄여 보세요.";
  } else if (negative.some(s => s.includes("공부시간"))) {
    recommendation = "공부 시작 시간을 고정하고 최소 20분 타이머 2회만 먼저 완주해 총 공부시간을 다시 끌어올려 보세요.";
  } else if (negative.some(s => s.includes("목표 달성률"))) {
    recommendation = "내일 목표 개수를 1~2개 줄여 완료 경험을 먼저 만들고, 달성률이 회복되면 다시 늘려 보세요.";
  }

  return {
    key: "ai_pat_0",
    title: "이틀 기록 기반 변화 신호",
    severity: negative.length >= 2 ? "높음" : negative.length === 1 ? "보통" : "낮음",
    explanation: `${compareLabel} 기준으로 ${summaryParts.join(". ")}.`,
    recommendation
  };
}

/** 마크다운·앞뒤 잡담이 섞인 응답에서 patterns JSON 추출 */
function parsePatternsJsonFromAssistantText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const tryParse = s => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let obj = tryParse(t);
  if (obj && Array.isArray(obj.patterns)) return obj;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    obj = tryParse(fenced[1].trim());
    if (obj && Array.isArray(obj.patterns)) return obj;
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    obj = tryParse(t.slice(start, end + 1));
    if (obj && Array.isArray(obj.patterns)) return obj;
  }
  return null;
}

async function openAiPatternCompletion(payload) {
  const userContent = JSON.stringify(payload);
  const systemContent =
    "너는 한국 중·고등학생 학습 코치다. 입력 JSON의 weekRhythm 배열에서 최근 7일의 다섯 지표(sleepHours, stressScore, concentrationPercent, studyMinutes, planCompletionRate)만 근거로 2~6개의 패턴을 진단한다. null은 해당 날 미기록이며 억지 추정은 금지한다. 의학·정신질환 진단, 자해 조장, 시험 부정행위는 금지. 반드시 아래 형태의 JSON만 출력하고 다른 글자는 쓰지 마라: {\"patterns\":[{\"title\":\"짧은 제목\",\"severity\":\"낮음\"|\"보통\"|\"높음\",\"explanation\":\"2~4문장\",\"recommendation\":\"실행 팁 1~2문장\"}]}. 기록이 거의 없으면 patterns는 1개로 짧게 안내한다.";
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ];
  const baseArgs = {
    model: OPENAI_MODEL,
    temperature: 0.35,
    max_tokens: 1400,
    messages
  };
  let text = "";
  try {
    const res = await openai.chat.completions.create({
      ...baseArgs,
      response_format: { type: "json_object" }
    });
    text = String(res.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    console.warn(
      "[pattern-insights] json_object 모드 실패, 일반 모드로 재시도:",
      e?.message || e
    );
    const res = await openai.chat.completions.create(baseArgs);
    text = String(res.choices?.[0]?.message?.content || "").trim();
  }
  let parsed = parsePatternsJsonFromAssistantText(text);
  let lastText = text;
  if (!parsed && text) {
    const res2 = await openai.chat.completions.create(baseArgs);
    lastText = String(res2.choices?.[0]?.message?.content || "").trim();
    parsed = parsePatternsJsonFromAssistantText(lastText);
  }
  return { parsed, rawText: lastText };
}

function isIsoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function toNullableString(v, maxLen = 200) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function toNullableNumber(v, min, max) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function sanitizeStringArray(value, maxItems = 12, maxLen = 30) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map(v => v.slice(0, maxLen));
}

function isScheduleManagementRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return [
    "일정을 관리하고 싶어요",
    "일정 관리",
    "일정 추가",
    "일정 수정",
    "일정 변경",
    "반복 일정",
    "이번 주 일정"
  ].some(keyword => t.includes(keyword));
}

function buildScheduleManagementReply() {
  return [
    "일정 관리 도와드릴게요.",
    "먼저 이 일정이 매주 반복되는 일정인지, 이번 주만 있는 일정인지 알려주세요.",
    "예를 들면 `매주 월수금 7시 수학 학원`, `이번 주 토요일만 2시 모의고사`처럼 말씀해 주시면 돼요.",
    "반복 여부와 요일 또는 날짜를 알려주시면 다음으로 시간과 내용을 정리해볼게요."
  ].join("\n");
}

function looksLikeScheduleDetails(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const dayPattern = /(월|화|수|목|금|토|일)요일|월수금|화목|주말|평일|매주|매일|마다/;
  const timePattern = /\b\d{1,2}시(\s?반)?\b|\b\d{1,2}:\d{2}\b|오전|오후/;
  const durationPattern = /\b\d+시간\b|\b\d+분\b/;
  const eventPattern = /수업|학원|과외|모의고사|시험|약속|미팅|병원|레슨|보강|동아리|스터디/;
  return (
    dayPattern.test(t) ||
    (timePattern.test(t) && eventPattern.test(t)) ||
    (durationPattern.test(t) && eventPattern.test(t))
  );
}

function isScheduleConversation(text, history = []) {
  if (isScheduleManagementRequest(text) || looksLikeScheduleDetails(text)) return true;
  const recent = Array.isArray(history) ? history.slice(-6) : [];
  return recent.some(m => {
    const content = String(m?.content || "").trim();
    return (
      content.includes("일정 관리") ||
      content.includes("반복되는 일정인지") ||
      content.includes("이번 주만 있는") ||
      content.includes("요일 또는 날짜")
    );
  });
}

function parseJsonObjectFromAssistantText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const tryParse = s => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let obj = tryParse(t);
  if (obj && typeof obj === "object") return obj;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    obj = tryParse(fenced[1].trim());
    if (obj && typeof obj === "object") return obj;
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    obj = tryParse(t.slice(start, end + 1));
    if (obj && typeof obj === "object") return obj;
  }
  return null;
}

function serializeStudentProfileSchedule(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title || ""),
    date: formatPgLogDate(row.schedule_date),
    startTime: String(row.start_time || "").slice(0, 5),
    endTime:
      row.end_time != null && String(row.end_time).trim() !== ""
        ? String(row.end_time).slice(0, 5)
        : null,
    isRecurring: Boolean(row.is_recurring),
    recurrenceRule:
      row.recurrence_rule != null && String(row.recurrence_rule).trim() !== ""
        ? String(row.recurrence_rule)
        : null,
    excludedDates: Array.isArray(row.excluded_dates) ? row.excluded_dates : [],
    source: String(row.source || "manual"),
    note:
      row.note != null && String(row.note).trim() !== ""
        ? String(row.note)
        : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeScheduleDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || "").trim().slice(0, 120);
  const date = String(raw.date || "").trim().slice(0, 10);
  const startTime = String(raw.startTime || "").trim().slice(0, 5);
  const endTime = String(raw.endTime || "").trim().slice(0, 5);
  const isRecurring = Boolean(raw.isRecurring);
  const recurrenceRule = String(raw.recurrenceRule || "").trim().slice(0, 120);
  const note = String(raw.note || "").trim().slice(0, 300);
  return {
    title,
    date,
    startTime,
    endTime,
    isRecurring,
    recurrenceRule,
    note
  };
}

function normalizePartialTimeToken(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    return `${String(Number(hhmm[1])).padStart(2, "0")}:${hhmm[2]}`;
  }
  const kor = s.match(/^(오전|오후)?\s*(\d{1,2})시(\s*반)?$/);
  if (!kor) return null;
  let hour = Number(kor[2]);
  if (kor[1] === "오후" && hour < 12) hour += 12;
  if (kor[1] === "오전" && hour === 12) hour = 0;
  const minute = kor[3] ? 30 : 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timePartsToToken(meridiem, hourText, minuteText, hasHalf) {
  let hour = Number(hourText);
  if (!Number.isFinite(hour)) return null;
  if (meridiem === "오후" && hour < 12) hour += 12;
  if (meridiem === "오전" && hour === 12) hour = 0;
  const minute = minuteText != null && minuteText !== "" ? Number(minuteText) : hasHalf ? 30 : 0;
  if (!Number.isFinite(minute)) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractTimeHintsFromText(text) {
  const t = String(text || "").trim();
  if (!t) return { startTime: null, endTime: null };
  const simpleRange = t.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
  if (simpleRange) {
    return {
      startTime: normalizePartialTimeToken(simpleRange[1]),
      endTime: normalizePartialTimeToken(simpleRange[2])
    };
  }

  const startFrom = t.match(/(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*시?(\s*반)?(?:에)?\s*(시작|부터)/);
  const endTo = t.match(/(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*시?(\s*반)?(?:에)?\s*(끝|끝나|끝나요|종료|까지)/);
  const bareSingle = t.match(/^(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*시?(\s*반)?$/);

  let startTime = null;
  let endTime = null;
  if (startFrom) {
    startTime = timePartsToToken(startFrom[1], startFrom[2], startFrom[3], Boolean(startFrom[4]));
  }
  if (endTo) {
    endTime = timePartsToToken(endTo[1], endTo[2], endTo[3], Boolean(endTo[4]));
  }
  if (!startTime && !endTime && bareSingle) {
    startTime = timePartsToToken(bareSingle[1], bareSingle[2], bareSingle[3], Boolean(bareSingle[4]));
  }

  const duration = t.match(/(\d+)시간\s*동안|(\d+)분\s*동안/);
  if (!endTime && startTime && duration) {
    const startMin = hhmmToMinutes(startTime);
    if (startMin != null) {
      const delta = duration[1] ? Number(duration[1]) * 60 : Number(duration[2]);
      const total = startMin + delta;
      endTime = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }
  }

  return { startTime, endTime };
}

function extractScheduleTitleFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const patterns = [
    /([가-힣A-Za-z0-9 ]+?)(수업|학원 보강|학원|보강|과외|시험|모의고사)/,
    /(영어|수학|국어|생명과학|지구과학|사회|과학|과외|학원)/
  ];
  for (const pattern of patterns) {
    const m = t.match(pattern);
    if (!m) continue;
    if (m[2]) {
      return `${String(m[1] || "").trim()}${String(m[2] || "").trim()}`.trim();
    }
    return String(m[1] || "").trim();
  }
  return null;
}

function extractRecurrenceFromText(text) {
  const t = String(text || "").trim();
  if (!t) return { isRecurring: false, recurrenceRule: null };
  if (/매주|마다/.test(t)) {
    const day = t.match(/(월|화|수|목|금|토|일)요일|월수금|화목|주말|평일/);
    return {
      isRecurring: true,
      recurrenceRule: day ? String(day[0]).trim() : "매주 반복"
    };
  }
  return { isRecurring: false, recurrenceRule: null };
}

function isScheduleDraftResetRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return [
    /아니\s*그거\s*말고/,
    /그거\s*말고/,
    /안\s*하기로\s*했어/,
    /안\s*할래/,
    /추가\s*안\s*할래/,
    /추가\s*하지\s*마/,
    /등록\s*안\s*할래/,
    /취소할래/,
    /방금\s*말한\s*일정\s*취소/,
    /이전\s*일정\s*취소/
  ].some(pattern => pattern.test(t));
}

function collectActiveScheduleUserTexts(history = [], latestText = "") {
  const texts = [
    ...((Array.isArray(history) ? history : [])
      .filter(m => m && m.role !== "assistant")
      .map(m => String(m.content || ""))),
    String(latestText || "")
  ];
  let startIndex = 0;
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    if (isScheduleDraftResetRequest(texts[i])) {
      startIndex = i + 1;
      break;
    }
  }
  return texts.slice(startIndex);
}

function accumulateScheduleDraft(history = [], latestText = "", parsedSchedule = null) {
  const draft = {
    title: parsedSchedule?.title || "",
    date: parsedSchedule?.date || "",
    startTime: parsedSchedule?.startTime || "",
    endTime: parsedSchedule?.endTime || "",
    isRecurring: Boolean(parsedSchedule?.isRecurring),
    recurrenceRule: parsedSchedule?.recurrenceRule || "",
    note: parsedSchedule?.note || ""
  };

  const userTexts = collectActiveScheduleUserTexts(history, latestText);

  for (const text of userTexts) {
    if (!draft.date) {
      const date = extractReferencedDateFromText(text);
      if (date) draft.date = date;
    }
    if (!draft.title) {
      const title = extractScheduleTitleFromText(text);
      if (title) draft.title = title;
    }
    const timeHints = extractTimeHintsFromText(text);
    if (!draft.startTime && timeHints.startTime) draft.startTime = timeHints.startTime;
    if (!draft.endTime && timeHints.endTime) draft.endTime = timeHints.endTime;
    if (!draft.recurrenceRule || !draft.isRecurring) {
      const recurrence = extractRecurrenceFromText(text);
      if (recurrence.isRecurring) {
        draft.isRecurring = true;
        draft.recurrenceRule = recurrence.recurrenceRule || draft.recurrenceRule;
      }
    }
  }

  return draft;
}

function normalizeScheduleUpdateDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const scheduleId = Number(raw.scheduleId || raw.id || 0);
  const schedule = normalizeScheduleDraft(raw.schedule);
  if (!Number.isFinite(scheduleId) || scheduleId <= 0 || !schedule) return null;
  return {
    scheduleId,
    schedule
  };
}

function getMissingScheduleFields(schedule) {
  if (!schedule) {
    return ["일정 제목", "날짜 또는 요일", "시작 시간", "종료 시간"];
  }
  const missing = [];
  if (!schedule.title) missing.push("일정 제목");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) missing.push("날짜 또는 요일");
  if (!/^\d{2}:\d{2}$/.test(schedule.startTime)) missing.push("시작 시간");
  if (!/^\d{2}:\d{2}$/.test(schedule.endTime)) missing.push("종료 시간");
  if (schedule.isRecurring && !schedule.recurrenceRule) missing.push("반복 정보");
  return missing;
}

function buildMissingScheduleFieldsMessage(missing) {
  if (!Array.isArray(missing) || missing.length === 0) {
    return "일정을 저장하려면 날짜, 시작 시간, 종료 시간이 모두 확정되어야 해요. 일정을 한 번 더 확인해 주세요.";
  }
  if (missing.includes("종료 시간") && !missing.includes("시작 시간")) {
    return "시작 시간은 확인됐어요. 몇 시에 끝나는지도 알려주세요. 시작 시간과 종료 시간이 둘 다 있어야 일정을 저장할 수 있어요.";
  }
  if (missing.includes("시작 시간") && !missing.includes("종료 시간")) {
    return "종료 시간은 확인됐어요. 몇 시에 시작하는지 알려주세요. 시작 시간과 종료 시간이 둘 다 있어야 일정을 저장할 수 있어요.";
  }
  if (missing.includes("시작 시간") && missing.includes("종료 시간")) {
    return "몇 시부터 몇 시까지인지 알려주세요. 시작 시간과 종료 시간이 둘 다 있어야 일정을 저장할 수 있어요.";
  }
  return `${missing.join(", ")} 정보가 아직 확실하지 않아요. 시작 시간과 종료 시간이 둘 다 확정되어야 저장할 수 있으니, 정확한 날짜(또는 반복 요일)와 몇 시부터 몇 시까지인지 다시 알려주세요.`;
}

function hhmmToMinutes(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour === 24 && minute === 0) return 24 * 60;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function weekdayKeyFromDate(dateText) {
  const iso = formatPgLogDate(dateText);
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return utc.getUTCDay();
}

function scheduleOccursOnDate(scheduleRow, targetDate) {
  const target = formatPgLogDate(targetDate);
  const rowDate = formatPgLogDate(scheduleRow?.schedule_date);
  if (!target || !rowDate) return false;
  const excludedDates = Array.isArray(scheduleRow?.excluded_dates)
    ? scheduleRow.excluded_dates.map(v => formatPgLogDate(v)).filter(Boolean)
    : [];
  if (excludedDates.includes(target)) return false;
  if (!scheduleRow?.is_recurring) return rowDate === target;
  return weekdayKeyFromDate(rowDate) === weekdayKeyFromDate(target);
}

function findScheduleConflicts(existingRows, draft, options = {}) {
  const draftStart = hhmmToMinutes(draft?.startTime);
  const draftEnd = hhmmToMinutes(draft?.endTime);
  if (draftStart == null || draftEnd == null) return [];
  const ignoreScheduleId =
    Number.isFinite(Number(options.ignoreScheduleId)) && Number(options.ignoreScheduleId) > 0
      ? Number(options.ignoreScheduleId)
      : null;
  return (existingRows || [])
    .filter(row => (ignoreScheduleId == null ? true : Number(row.id) !== ignoreScheduleId))
    .filter(row => scheduleOccursOnDate(row, draft.date))
    .filter(row => {
      const rowStart = hhmmToMinutes(row.start_time);
      const rowEnd = hhmmToMinutes(row.end_time);
      if (rowStart == null || rowEnd == null) return false;
      return draftStart < rowEnd && draftEnd > rowStart;
    })
    .map(serializeStudentProfileSchedule)
    .filter(Boolean);
}

function buildScheduleConflictMessage(draft, conflicts) {
  const lead = `추가하려는 일정 ${draft.startTime}~${draft.endTime} "${draft.title}" 이 기존 일정과 겹쳐요.`;
  const details = conflicts
    .slice(0, 3)
    .map(item => `- ${item.title}: ${item.date} ${item.startTime}${item.endTime ? `~${item.endTime}` : ""}`)
    .join("\n");
  return [
    lead,
    details,
    "시간을 바꾸거나 기존 일정을 수정할지 정해야 해서, 그대로 저장하지는 않았어요.",
    "새 일정 시간을 조정할지, 기존 일정을 바꿀지 말씀해 주세요."
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeScheduleRowsForPrompt(rows) {
  return (rows || []).map(row => ({
    id: Number(row.id),
    title: String(row.title || ""),
    date: formatPgLogDate(row.schedule_date),
    startTime: String(row.start_time || "").slice(0, 5),
    endTime:
      row.end_time != null && String(row.end_time).trim() !== ""
        ? String(row.end_time).slice(0, 5)
        : null,
    isRecurring: Boolean(row.is_recurring),
    recurrenceRule:
      row.recurrence_rule != null && String(row.recurrence_rule).trim() !== ""
        ? String(row.recurrence_rule)
        : null,
    excludedDates: Array.isArray(row.excluded_dates) ? row.excluded_dates : []
  }));
}

function minutesToHhmm(totalMinutes) {
  const n = Number(totalMinutes);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded >= 24 * 60) return "24:00";
  const safe = Math.max(0, Math.min(23 * 60 + 59, rounded));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTomorrowPlanDraft(rawPlanDraft, books = []) {
  const byId = new Map(
    (books || []).map(book => [Number(book.id), String(book.name || "").trim()])
  );
  if (!Array.isArray(rawPlanDraft)) return [];
  return rawPlanDraft
    .map(item => {
      const bookId = Number(item?.bookId || 0);
      const bookName = String(item?.bookName || byId.get(bookId) || "")
        .trim()
        .slice(0, 120);
      const plannedRange = String(item?.plannedRange || item?.text || "")
        .trim()
        .slice(0, 240);
      const startTime = String(item?.startTime || item?.start || "")
        .trim()
        .slice(0, 5);
      const endTime = String(item?.endTime || item?.end || "")
        .trim()
        .slice(0, 5);
      return {
        bookId: Number.isFinite(bookId) && bookId > 0 ? bookId : null,
        bookName,
        plannedRange,
        startTime: /^\d{2}:\d{2}$/.test(startTime) ? startTime : "",
        endTime: /^\d{2}:\d{2}$/.test(endTime) ? endTime : ""
      };
    })
    .filter(item => item.bookName || item.plannedRange || item.startTime || item.endTime);
}

function normalizeInstalledAppsForPrompt(rows) {
  return (rows || [])
    .map(app => ({
      id: String(app.id || app.app_key || app.bundleId || "").trim(),
      name: String(app.name || "").trim(),
      category: String(app.category || "").trim() || "기기 앱",
      description: String(app.description || app.bundleId || "").trim(),
      bundleId: String(app.bundleId || "").trim() || null
    }))
    .filter(app => app.id && app.name);
}

function pickFallbackAllowedApps(installedApps, slot) {
  const list = Array.isArray(installedApps) ? installedApps : [];
  if (list.length === 0) return [];
  const text = `${slot?.title || ""} ${slot?.detail || ""} ${slot?.reason || ""}`
    .trim()
    .toLowerCase();
  return list
    .filter(app => {
      const name = String(app.name || "").trim().toLowerCase();
      return Boolean(name) && text.includes(name);
    });
}

function fillDailyCoverageSlots(slots) {
  const sorted = [...(slots || [])].sort(
    (a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime)
  );
  const covered = [];
  let cursor = 0;

  for (const slot of sorted) {
    const startMin = hhmmToMinutes(slot.startTime);
    const endMin = hhmmToMinutes(slot.endTime);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    const safeStart = Math.max(cursor, startMin);
    if (safeStart > cursor) {
      covered.push({
        title: "계획 없음",
        source: "free",
        startTime: minutesToHhmm(cursor),
        endTime: minutesToHhmm(safeStart),
        reason: "학습 계획이나 등록 일정이 없는 시간대입니다.",
        allowedApps: []
      });
    }
    covered.push({
      ...slot,
      startTime: minutesToHhmm(safeStart),
      endTime: minutesToHhmm(endMin)
    });
    cursor = Math.max(cursor, endMin);
  }

  if (cursor < 24 * 60) {
    covered.push({
      title: "계획 없음",
      source: "free",
      startTime: minutesToHhmm(cursor),
      endTime: minutesToHhmm(24 * 60),
      reason: "학습 계획이나 등록 일정이 없는 시간대입니다.",
      allowedApps: []
    });
  }

  if (covered.length === 0) {
    return [
      {
        title: "계획 없음",
        source: "free",
        startTime: "00:00",
        endTime: "24:00",
        reason: "학습 계획이나 등록 일정이 없는 하루입니다.",
        allowedApps: []
      }
    ];
  }
  return covered;
}

function buildFallbackAppAllowancePlan({ tomorrowKey, scheduleRows, planRows, installedApps }) {
  const slots = [];
  const pushSlot = slot => {
    const startMin = hhmmToMinutes(slot.startTime);
    const endMin = hhmmToMinutes(slot.endTime);
    if (startMin == null || endMin == null || endMin <= startMin) return;
    slots.push({
      title: String(slot.title || "").trim() || "시간표",
      source: slot.source === "schedule" ? "schedule" : "plan",
      startTime: slot.startTime,
      endTime: slot.endTime,
      reason: String(slot.reason || "").trim().slice(0, 180),
      detail: String(slot.detail || "").trim().slice(0, 180)
    });
  };

  for (const row of scheduleRows || []) {
    const startTime = String(row.start_time || "").slice(0, 5);
    const endTime = String(row.end_time || "").slice(0, 5);
    pushSlot({
      title: String(row.title || "").trim(),
      source: "schedule",
      startTime,
      endTime,
      reason: "학생 일정에 이미 등록된 고정 시간대입니다.",
      detail: row.note || row.recurrence_rule || ""
    });
  }

  const timedPlanRows = (planRows || []).filter(
    item => /^\d{2}:\d{2}$/.test(String(item.startTime || "")) && /^\d{2}:\d{2}$/.test(String(item.endTime || ""))
  );
  for (const row of timedPlanRows) {
    pushSlot({
      title: row.bookName ? `${row.bookName} 공부` : "내일 계획 공부",
      source: "plan",
      startTime: row.startTime,
      endTime: row.endTime,
      reason: "내일 계획에 직접 적은 공부 시간입니다.",
      detail: row.plannedRange || ""
    });
  }

  slots.sort((a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime));

  const untimedPlans = (planRows || []).filter(
    item => !(/^\d{2}:\d{2}$/.test(String(item.startTime || "")) && /^\d{2}:\d{2}$/.test(String(item.endTime || "")))
  );
  const windows = [];
  let cursor = 0;
  for (const slot of slots) {
    const startMin = hhmmToMinutes(slot.startTime);
    const endMin = hhmmToMinutes(slot.endTime);
    if (startMin == null || endMin == null) continue;
    if (startMin - cursor >= 50) {
      windows.push({ start: cursor, end: startMin });
    }
    cursor = Math.max(cursor, endMin + 10);
  }
  if (24 * 60 - cursor >= 50) {
    windows.push({ start: cursor, end: 24 * 60 });
  }

  let windowIndex = 0;
  let fallbackCursor = cursor;
  for (const row of untimedPlans) {
    let startMin = null;
    let endMin = null;
    while (windowIndex < windows.length) {
      const window = windows[windowIndex];
      if (window.end - window.start < 50) {
        windowIndex += 1;
        continue;
      }
      startMin = window.start;
      endMin = Math.min(window.start + 90, window.end);
      window.start = endMin + 10;
      if (window.start >= window.end - 40) windowIndex += 1;
      break;
    }
    if (startMin == null || endMin == null || endMin <= startMin) {
      startMin = Math.min(fallbackCursor, 23 * 60);
      endMin = Math.min(startMin + 60, 24 * 60);
      fallbackCursor = endMin + 10;
    }
    const startTime = minutesToHhmm(startMin);
    const endTime = minutesToHhmm(endMin);
    if (!startTime || !endTime) continue;
    pushSlot({
      title: row.bookName ? `${row.bookName} 공부` : "내일 계획 공부",
      source: "plan",
      startTime,
      endTime,
      reason: "고정 시간이 없어 비어 있는 시간대에 우선 배치했습니다.",
      detail: row.plannedRange || ""
    });
  }

  const normalizedSlots = slots
    .sort((a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime))
    .map(slot => ({
      title: slot.title,
      source: slot.source,
      startTime: slot.startTime,
      endTime: slot.endTime,
      reason: slot.reason,
      allowedApps: pickFallbackAllowedApps(installedApps, slot)
    }));

  const fullDaySlots = fillDailyCoverageSlots(normalizedSlots);

  const weekday = getKoreanWeekdayNameFromIsoDate(tomorrowKey);
  const relatedCount = normalizedSlots.filter(slot => slot.source !== "free").length;
  const summary =
    relatedCount > 0
      ? `내일 ${weekday ? `${weekday}요일 ` : ""}일정과 계획만 반영해 24시간 시간표로 정리했어요.`
      : "내일 일정이나 학습 계획이 없어 24시간 전체를 계획 없음으로 표시했어요.";

  return { summary, slots: fullDaySlots };
}

function normalizeAppAllowanceResponse(raw, installedApps) {
  if (!raw || typeof raw !== "object") return null;
  const installedById = new Map((installedApps || []).map(app => [app.id, app]));
  const installedByName = new Map(
    (installedApps || []).map(app => [String(app.name || "").trim().toLowerCase(), app])
  );
  const slots = Array.isArray(raw.slots)
    ? raw.slots
        .map(slot => {
          const startTime = String(slot?.startTime || "").trim().slice(0, 5);
          const endTime = String(slot?.endTime || "").trim().slice(0, 5);
          const startMin = hhmmToMinutes(startTime);
          const endMin = hhmmToMinutes(endTime);
          if (startMin == null || endMin == null || endMin <= startMin) return null;
          const picked = [];
          const rawIds = Array.isArray(slot?.allowedAppIds) ? slot.allowedAppIds : [];
          const rawNames = Array.isArray(slot?.allowedAppNames) ? slot.allowedAppNames : [];
          for (const candidate of rawIds) {
            const app = installedById.get(String(candidate || "").trim());
            if (app && !picked.some(item => item.id === app.id)) picked.push(app);
          }
          for (const candidate of rawNames) {
            const app = installedByName.get(String(candidate || "").trim().toLowerCase());
            if (app && !picked.some(item => item.id === app.id)) picked.push(app);
          }
          return {
            title: String(slot?.title || "").trim().slice(0, 120) || "시간표",
            source:
              slot?.source === "schedule"
                ? "schedule"
                : slot?.source === "free"
                  ? "free"
                  : "plan",
            startTime,
            endTime,
            reason: String(slot?.reason || "").trim().slice(0, 180),
            allowedApps: picked
          };
        })
        .filter(Boolean)
        .sort((a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime))
    : [];
  const fullDaySlots = fillDailyCoverageSlots(slots);
  return {
    summary: String(raw.summary || "").trim().slice(0, 240),
    slots: fullDaySlots
  };
}

async function generateStudentAppAllowancePlan({
  tomorrowKey,
  tomorrowSchedules,
  tomorrowPlans,
  installedApps
}) {
  const fallback = buildFallbackAppAllowancePlan({
    tomorrowKey,
    scheduleRows: tomorrowSchedules,
    planRows: tomorrowPlans,
    installedApps
  });
  if (!openai) {
    return { ...fallback, usedOpenAi: false, model: null };
  }

  const promptPayload = {
    tomorrowDate: tomorrowKey,
    tomorrowWeekday: getKoreanWeekdayNameFromIsoDate(tomorrowKey),
    schedules: serializeScheduleRowsForPrompt(tomorrowSchedules),
    studyPlans: (tomorrowPlans || []).map(item => ({
      bookName: item.bookName,
      plannedRange: item.plannedRange,
      startTime: item.startTime || null,
      endTime: item.endTime || null
    })),
    installedApps
  };

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.35,
      max_tokens: 1100,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "너는 한국 학생의 내일 휴대폰 허용 앱 시간표를 짜는 코치다. 반드시 학습 계획(studyPlans)과 등록 일정(schedules)에 직접 근거한 내용만 사용해야 하며, 제공되지 않은 새로운 공부 주제·앱·활동을 임의로 만들면 안 된다. schedules는 고정 일정이므로 시간을 바꾸지 않는다. studyPlans 중 startTime/endTime이 둘 다 있는 항목도 고정 시간으로 유지한다. 시간이 없는 studyPlans만 남는 시간대에 배치할 수 있다. 결과는 00:00부터 24:00까지 하루 전체가 빈틈없이 이어지는 슬롯이어야 하며, 슬롯끼리 절대 겹치면 안 된다. 계획이나 일정이 없는 구간은 source를 free, title을 계획 없음, allowedAppIds를 빈 배열로 둔다. installedApps에 있는 id만 allowedAppIds에 넣을 수 있고, 계획/일정 텍스트와 직접 관련이 없는 앱은 넣지 않는다. 반드시 JSON 객체만 출력한다. 형식은 {\"summary\":\"한두 문장\",\"slots\":[{\"title\":\"표시 제목\",\"source\":\"schedule\"|\"plan\"|\"free\",\"startTime\":\"HH:MM\",\"endTime\":\"HH:MM\",\"reason\":\"짧은 근거\",\"allowedAppIds\":[\"quizlet\"]}]} 이다."
        },
        {
          role: "user",
          content: JSON.stringify(promptPayload)
        }
      ]
    });
    const rawText = String(response.choices?.[0]?.message?.content || "").trim();
    const parsed = parseJsonObjectFromAssistantText(rawText);
    const normalized = normalizeAppAllowanceResponse(parsed, installedApps);
    if (!normalized || normalized.slots.length === 0) {
      return { ...fallback, usedOpenAi: false, model: null };
    }
    return {
      summary: normalized.summary || fallback.summary,
      slots: normalized.slots,
      usedOpenAi: true,
      model: OPENAI_MODEL
    };
  } catch (e) {
    console.warn("/api/student/coach/app-timetable openai fallback:", e?.message || e);
    return { ...fallback, usedOpenAi: false, model: null };
  }
}

function summarizeWeekDataForCoach(weekData) {
  const days = Array.isArray(weekData?.days) ? weekData.days : [];
  const blocks = Array.isArray(weekData?.blocks) ? weekData.blocks : [];
  const plans = Array.isArray(weekData?.plans) ? weekData.plans : [];
  const dayIdToDate = new Map(
    days.map(day => [Number(day.id), formatPgLogDate(day.date)]).filter(([, date]) => Boolean(date))
  );
  const byDate = new Map();

  const ensureDateSummary = date => {
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        totalStudyMinutes: 0,
        totalBlocks: 0,
        doneBlocks: 0,
        subjects: [],
        planBooks: []
      });
    }
    return byDate.get(date);
  };

  for (const block of blocks) {
    const dayId = Number(block?.study_day_id);
    const date = dayIdToDate.get(dayId);
    if (!date) continue;
    const item = ensureDateSummary(date);
    item.totalBlocks += 1;
    if (Boolean(block?.done)) item.doneBlocks += 1;

    const start = hhmmToMinutes(block?.start_time);
    const end = hhmmToMinutes(block?.end_time);
    if (start != null && end != null && end > start) {
      item.totalStudyMinutes += end - start;
    }

    const subject = String(block?.subject || "").trim();
    if (subject && !item.subjects.includes(subject)) {
      item.subjects.push(subject);
    }
  }

  for (const plan of plans) {
    const dayId = Number(plan?.study_day_id);
    const date = dayIdToDate.get(dayId);
    if (!date) continue;
    const item = ensureDateSummary(date);
    const book = String(plan?.book_name || "").trim();
    if (book && !item.planBooks.includes(book)) {
      item.planBooks.push(book);
    }
  }

  return [...byDate.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-7)
    .map(item => ({
      date: item.date,
      totalStudyMinutes: item.totalStudyMinutes,
      totalBlocks: item.totalBlocks,
      doneBlocks: item.doneBlocks,
      subjects: item.subjects.slice(0, 6),
      planBooks: item.planBooks.slice(0, 6)
    }));
}

function buildPersistentCoachDbContext({ me, profile, snapshot, recentLogs, existingScheduleRows, weekData }) {
  const today = formatYmdSeoulFromInstant(new Date());
  const nameFromProfile = String(profile?.name || "").trim();
  const nameFromEmail = String(me?.email || "").split("@")[0].trim();
  const studentName = nameFromProfile || nameFromEmail || "학생";
  const goal = String(profile?.goal || "").trim() || null;

  const schedules = serializeScheduleRowsForPrompt(existingScheduleRows);
  const upcomingSchedules = schedules
    .filter(item => item?.date && String(item.date) >= today)
    .slice(0, 20);

  const latestLog = Array.isArray(recentLogs) && recentLogs.length > 0 ? recentLogs[0] : null;
  const latestDailyRecord = latestLog
    ? {
        date: formatPgLogDate(latestLog.log_date),
        studyMinutes:
          latestLog.study_minutes != null && Number.isFinite(Number(latestLog.study_minutes))
            ? Number(latestLog.study_minutes)
            : null,
        planCompletionRate:
          latestLog.plan_completion_rate != null &&
          Number.isFinite(Number(latestLog.plan_completion_rate))
            ? Number(latestLog.plan_completion_rate)
            : null,
        studyEvaluation: String(latestLog.study_evaluation || "").trim() || null,
        metacognitionReflection:
          String(latestLog.metacognition_reflection || "").trim() || null,
        tomorrowPractice: String(latestLog.tomorrow_practice || "").trim() || null
      }
    : null;

  return {
    generatedAt: new Date().toISOString(),
    student: {
      id: Number(me?.id),
      name: studentName,
      goal
    },
    profileSummary: snapshot?.profile || null,
    coachSnapshot: {
      heroNarrative: snapshot?.heroNarrative || null,
      metrics: snapshot?.metrics || null,
      nextActions: Array.isArray(snapshot?.nextActions)
        ? snapshot.nextActions.slice(0, 3)
        : []
    },
    latestDailyRecord,
    recentWeekStudySummary: summarizeWeekDataForCoach(weekData),
    upcomingSchedules,
    scheduleCount: schedules.length
  };
}

function textIncludesNormalized(text, target) {
  const a = String(text || "").replace(/\s+/g, "").trim();
  const b = String(target || "").replace(/\s+/g, "").trim();
  return Boolean(a && b && a.includes(b));
}

function extractReferencedDateFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const explicit = formatPgLogDate(t);
  if (explicit) return explicit;
  const today = formatYmdSeoulFromInstant(new Date());
  if (t.includes("모레")) return addDaysToSeoulDateKey(today, 2);
  if (t.includes("내일")) return addDaysToSeoulDateKey(today, 1);
  if (t.includes("오늘")) return today;
  return null;
}

function findDeleteCandidatesFromText(text, existingRows) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const titleMatches = rows.filter(row => textIncludesNormalized(text, row.title));
  const refDate = extractReferencedDateFromText(text);
  const dateMatches = refDate
    ? rows.filter(row => scheduleOccursOnDate(row, refDate))
    : [];

  if (titleMatches.length > 0 && dateMatches.length > 0) {
    const overlap = titleMatches.filter(row => dateMatches.some(d => Number(d.id) === Number(row.id)));
    if (overlap.length > 0) return overlap;
  }
  if (titleMatches.length > 0) return titleMatches;
  if (dateMatches.length > 0) return dateMatches;
  return [];
}

function buildAmbiguousDeleteMessage(candidates) {
  const items = (candidates || [])
    .slice(0, 5)
    .map(row => `- ${row.title}: ${formatPgLogDate(row.schedule_date)} ${String(row.start_time || "").slice(0, 5)}${row.end_time ? `~${String(row.end_time).slice(0, 5)}` : ""}`)
    .join("\n");
  return [
    "지울 수 있는 일정이 여러 개라서 어떤 일정을 취소할지 아직 확실하지 않아요.",
    items,
    "취소할 일정 이름이나 시간을 하나만 더 정확히 알려주세요."
  ]
    .filter(Boolean)
    .join("\n");
}

function conversationHasExplicitEndTimeInfo(history = [], latestText = "") {
  const texts = collectActiveScheduleUserTexts(history, latestText);
  return texts.some(text => {
    const t = String(text || "").trim();
    if (!t) return false;
    return (
      /\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2}/.test(t) ||
      /\d{1,2}시\s*부터\s*\d{1,2}시/.test(t) ||
      /\d{1,2}시\s*반\s*부터\s*\d{1,2}시/.test(t) ||
      /\d+시간\s*동안/.test(t) ||
      /\d+분\s*동안/.test(t) ||
      /까지/.test(t)
    );
  });
}

async function generateScheduleValidationReply(params) {
  const {
    scenario,
    userText,
    missingFields = [],
    conflicts = [],
    candidates = [],
    draft = null,
    snapshot = null,
    existingSchedules = []
  } = params || {};

  if (!openai) {
    if (scenario === "intent_reset") {
      return "알겠어. 방금 이야기하던 일정 추가는 진행하지 않을게. 새로 관리할 일정이 있으면 그 내용만 다시 말해줘.";
    }
    if (scenario === "missing_fields") {
      return buildMissingScheduleFieldsMessage(missingFields);
    }
    if (scenario === "conflict") {
      return buildScheduleConflictMessage(draft || {}, conflicts);
    }
    if (scenario === "ambiguous_delete") {
      return buildAmbiguousDeleteMessage(candidates);
    }
    return "일정 정보를 다시 한 번 확인해 주세요.";
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.25,
    max_tokens: 220,
    messages: [
      {
        role: "system",
        content:
          "너는 한국 학생의 일정 관리를 도와주는 AI 코치다. 서버 검증 결과를 학생에게 자연스럽고 짧은 한국어로 설명한다. 절대 JSON을 출력하지 말고, 지금 필요한 질문이나 안내만 2~4문장으로 답한다. 정보를 추정하지 말고 꼭 필요한 정보만 다시 물어본다. 사용자가 방금 논의하던 일정 자체를 접거나 말을 바꾼 상황이면 이전 일정은 더 붙잡지 말고, 그 일정은 진행하지 않겠다고 정리한 뒤 다음 일정 내용을 다시 물어본다."
      },
      {
        role: "system",
        content: `학생 프로필/요약: ${JSON.stringify(snapshot || {})}`
      },
      {
        role: "system",
        content: `현재 등록된 일정 목록: ${JSON.stringify(existingSchedules || [])}`
      },
      {
        role: "user",
        content: JSON.stringify({
          scenario,
          userText,
          missingFields,
          conflicts,
          candidates,
          draft
        })
      }
    ]
  });

  return String(response.choices?.[0]?.message?.content || "").trim();
}

async function applySchemaIfNeeded() {
  if (schemaApplied) return;
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await ensureConnected();
  const { pool } = require("./db");
  await pool.query(sql);
  schemaApplied = true;
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const extra = String(process.env.CORS_EXTRA_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const allowlist = new Set([
    WEB_APP_URL,
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost",
    ...extra
  ]);
  if (allowlist.has(origin)) return true;
  try {
    const u = new URL(origin);
    // Vercel preview/prod domains
    if (u.hostname.endsWith(".vercel.app")) return true;
    // local dev
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}

app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedCorsOrigin(origin)) return cb(null, true);
      return cb(new Error("CORS origin not allowed"));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    db: dbConnected ? "up" : "down"
  });
});

function parseCookieHeader(cookieHeader = "") {
  const map = {};
  for (const piece of String(cookieHeader).split(";")) {
    const idx = piece.indexOf("=");
    if (idx <= 0) continue;
    const k = piece.slice(0, idx).trim();
    const v = piece.slice(idx + 1).trim();
    if (!k) continue;
    map[k] = decodeURIComponent(v);
  }
  return map;
}

function isLikelySerial(serial) {
  const s = String(serial || "").trim();
  return /^[A-Za-z0-9._-]{6,80}$/.test(s);
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function attachDeviceByCookieIfPresent(req, userId) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const raw = cookies[WEBCLIP_COOKIE_NAME];
  if (!raw) return;
  const serial = await consumeWebclipSession(hashToken(raw));
  if (!serial) return;
  await linkDeviceToUserBySerial(userId, serial);
}

function resolveWebRedirect(raw) {
  const fallback = `${WEB_APP_URL}/`;
  const str = String(raw || "").trim();
  if (!str) return fallback;
  // Front SPA uses hash routing; direct /student can 404 on static hosting.
  if (str === "/student") return fallback;
  if (str.startsWith("/")) return `${WEB_APP_URL}${str}`;
  try {
    const parsed = new URL(str);
    const base = new URL(WEB_APP_URL);
    if (parsed.origin !== base.origin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function appendSerialToRedirect(targetUrl, serial) {
  if (!isLikelySerial(serial)) return targetUrl;
  try {
    const url = new URL(targetUrl);
    const hash = String(url.hash || "");
    if (hash.startsWith("#/")) {
      const qIdx = hash.indexOf("?");
      const hashPath = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
      const hashParams = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : "");
      hashParams.set("serial", serial);
      url.hash = `${hashPath}?${hashParams.toString()}`;
      return url.toString();
    }
    url.searchParams.set("serial", serial);
    return url.toString();
  } catch {
    return targetUrl;
  }
}

function getWebclipCookieOptions(req) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  // Frontend and backend are deployed on different origins, so the device
  // session cookie must allow cross-site credentialed requests.
  if (isHttps) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 10 * 60 * 1000,
      path: "/"
    };
  }
  return {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/"
  };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  try {
    const token = auth.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const rawId = decoded.userId;
    const uid = typeof rawId === "string" ? Number(rawId) : rawId;
    if (!Number.isFinite(Number(uid))) {
      return res.status(401).json({ error: "로그인 정보가 올바르지 않습니다." });
    }
    req.userId = uid;
    next();
  } catch (e) {
    return res
      .status(401)
      .json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
  }
}

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, role, serial, name } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "이메일과 비밀번호를 입력해 주세요." });
    }
    const trimmedEmail = String(email).trim().toLowerCase();
    if (trimmedEmail.length < 3) {
      return res
        .status(400)
        .json({ error: "이메일을 올바르게 입력해 주세요." });
    }
    if (String(password).length < 4) {
      return res
        .status(400)
        .json({ error: "비밀번호는 4자 이상이어야 합니다." });
    }
    const existing = await findUserByEmail(trimmedEmail);
    if (existing) {
      return res.status(409).json({ error: "이미 사용 중인 이메일입니다." });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const safeRole =
      role === "parent" || role === "student" ? role : "student";
    const userId = await createUser(trimmedEmail, hash, safeRole);
    if (safeRole === "student") {
      const studentName = String(name || "").trim().slice(0, 40);
      if (studentName) {
        await upsertStudentCoachProfile(userId, { name: studentName });
      }
    }
    if (isLikelySerial(serial)) {
      await linkDeviceToUserBySerial(userId, String(serial).trim()).catch(err => {
        console.warn("device link skipped on register body:", err.message);
      });
    }
    await attachDeviceByCookieIfPresent(req, userId).catch(err => {
      console.warn("device link skipped on register:", err.message);
    });
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, userId, email: trimmedEmail });
  } catch (e) {
    console.error("/auth/register error", e);
    res.status(500).json({ error: "회원가입에 실패했습니다." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password, serial } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "이메일과 비밀번호를 입력해 주세요." });
    }
    const user = await findUserByEmail(email);
    if (!user) {
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "30d"
    });
    if (isLikelySerial(serial)) {
      await linkDeviceToUserBySerial(user.id, String(serial).trim()).catch(err => {
        console.warn("device link skipped on login body:", err.message);
      });
    }
    await attachDeviceByCookieIfPresent(req, user.id).catch(err => {
      console.warn("device link skipped on login:", err.message);
    });
    res.json({ token, userId: user.id, email: user.email });
  } catch (e) {
    console.error("/auth/login error", e);
    res.status(500).json({ error: "로그인에 실패했습니다." });
  }
});

/**
 * WebClip 진입점:
 * /webclip/entry?serial=%SerialNumber%&next=/student
 * - serial 쿼리값은 1회용 HttpOnly 쿠키 세션으로 교체
 * - URL은 next(기본 /student)로 즉시 리다이렉트하여 노출 최소화
 */
app.get("/webclip/entry", async (req, res) => {
  const serial = String(req.query.serial || "").trim();
  const nextUrl = appendSerialToRedirect(
    resolveWebRedirect(req.query.next),
    serial
  );
  if (!isLikelySerial(serial)) {
    return res.redirect(302, nextUrl);
  }
  try {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await createWebclipSession(hashToken(rawToken), serial, expiresAt);
    res.cookie(WEBCLIP_COOKIE_NAME, rawToken, getWebclipCookieOptions(req));
    return res.redirect(302, nextUrl);
  } catch (e) {
    console.error("/webclip/entry error", e);
    return res.redirect(302, nextUrl);
  }
});

app.put("/api/blocks", authMiddleware, async (req, res) => {
  try {
    const { date, blocks } = req.body || {};
    if (!date || !Array.isArray(blocks)) {
      return res.status(400).json({ error: "date와 blocks가 필요합니다." });
    }
    const edit = await assertStudentCanEditDate(req.userId, String(date));
    if (!edit.ok) {
      return res.status(423).json({
        error:
          "잠금 상태에서는 오늘 계획을 수정할 수 없습니다. 내일 계획을 제출하면 잠금이 해제됩니다.",
        lockStatus: edit.status
      });
    }
    await replaceStudyBlocks(req.userId, date, blocks);
    const lockStatus = await getStudentLockStatus(req.userId);
    res.json({ ok: true, lockStatus });
  } catch (e) {
    console.error("/api/blocks error", e);
    res.status(500).json({ error: "타임라인 저장에 실패했습니다." });
  }
});

app.put("/api/plan", authMiddleware, async (req, res) => {
  try {
    const { date, plans } = req.body || {};
    if (!date || !Array.isArray(plans)) {
      return res.status(400).json({ error: "date와 plans가 필요합니다." });
    }
    const edit = await assertStudentCanEditDate(req.userId, String(date));
    if (!edit.ok) {
      return res.status(423).json({
        error:
          "잠금 상태에서는 오늘 계획을 수정할 수 없습니다. 내일 계획을 제출하면 잠금이 해제됩니다.",
        lockStatus: edit.status
      });
    }
    await upsertStudyPlans(req.userId, date, plans);
    const lockStatus = await getStudentLockStatus(req.userId);
    res.json({ ok: true, lockStatus });
  } catch (e) {
    console.error("/api/plan error", e);
    res.status(500).json({ error: "계획 저장에 실패했습니다." });
  }
});

app.get("/api/student/books", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const books = await listStudyBooks(req.userId);
    res.json({ books });
  } catch (e) {
    console.error("/api/student/books GET error", e);
    res.status(500).json({ error: "책 목록을 불러오지 못했습니다." });
  }
});

app.get("/api/student/profile-schedules", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const rows = await listStudentProfileSchedules(req.userId);
    res.json({ schedules: rows.map(serializeStudentProfileSchedule) });
  } catch (e) {
    console.error("/api/student/profile-schedules GET error", e);
    res.status(500).json({ error: "일정 목록을 불러오지 못했습니다." });
  }
});

app.post("/api/student/profile-schedules", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const body = req.body || {};
    const existingRows = await listStudentProfileSchedules(req.userId);
    const draft = {
      title: String(body.title || "").trim(),
      date: String(body.date || "").trim(),
      startTime: String(body.startTime || "").trim(),
      endTime: String(body.endTime || "").trim()
    };
    const conflicts = findScheduleConflicts(existingRows, draft);
    if (conflicts.length > 0) {
      return res.status(409).json({
        error: buildScheduleConflictMessage(draft, conflicts),
        conflicts
      });
    }
    const row = await createStudentProfileSchedule(req.userId, {
      title: body.title,
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      isRecurring: body.isRecurring,
      recurrenceRule: body.recurrenceRule,
      source: body.source,
      note: body.note
    });
    if (!row) {
      return res.status(400).json({ error: "일정 정보가 올바르지 않습니다." });
    }
    res.json({ ok: true, schedule: serializeStudentProfileSchedule(row) });
  } catch (e) {
    console.error("/api/student/profile-schedules POST error", e);
    res.status(500).json({ error: "일정을 저장하지 못했습니다." });
  }
});

app.delete("/api/student/profile-schedules/:id", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const scheduleId = Number(req.params.id);
    if (!Number.isFinite(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ error: "일정 id가 올바르지 않습니다." });
    }
    const ok = await deleteStudentProfileSchedule(req.userId, scheduleId);
    if (!ok) {
      return res.status(404).json({ error: "일정을 찾을 수 없습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/student/profile-schedules DELETE error", e);
    res.status(500).json({ error: "일정을 삭제하지 못했습니다." });
  }
});

app.post("/api/student/books", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const name = String((req.body || {}).name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "책 이름이 필요합니다." });
    }
    const row = await createStudyBook(req.userId, name);
    if (!row) {
      return res.status(500).json({ error: "책을 추가하지 못했습니다." });
    }
    res.json({ id: row.id, name: row.name });
  } catch (e) {
    console.error("/api/student/books POST error", e);
    res.status(500).json({ error: "책을 추가하지 못했습니다." });
  }
});

app.delete("/api/student/books/:id", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const bookId = Number(req.params.id);
    if (!Number.isFinite(bookId) || bookId <= 0) {
      return res.status(400).json({ error: "책 id가 올바르지 않습니다." });
    }
    const ok = await softDeleteStudyBook(req.userId, bookId);
    if (!ok) {
      return res.status(404).json({ error: "책을 찾을 수 없습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/student/books DELETE error", e);
    res.status(500).json({ error: "책을 삭제하지 못했습니다." });
  }
});

/** 특정 날짜의 책별 계획만 조회 (내일 계획 복원 — 주간 범위와 무관) */
app.get("/api/student/plans-by-date", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 접근할 수 있습니다." });
    }
    const date = String(req.query.date || "")
      .trim()
      .slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: "date 쿼리(YYYY-MM-DD)가 필요합니다." });
    }
    const { plans } = await getStudyPlansForDate(req.userId, date);
    res.json({ date, plans });
  } catch (e) {
    console.error("/api/student/plans-by-date GET error", e);
    res.status(500).json({ error: "계획을 불러오지 못했습니다." });
  }
});

app.get("/api/week", authMiddleware, async (req, res) => {
  try {
    const start = String(req.query.start || "").slice(0, 10);
    if (!start) {
      return res
        .status(400)
        .json({ error: "start 쿼리 파라미터(YYYY-MM-DD)가 필요합니다." });
    }
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) {
      return res
        .status(400)
        .json({ error: "start 형식이 올바르지 않습니다. (YYYY-MM-DD)" });
    }
    const endDate = new Date(startDate.getTime());
    endDate.setDate(startDate.getDate() + 6);
    const end = `${endDate.getFullYear()}-${String(
      endDate.getMonth() + 1
    ).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

    const { days, blocks, plans } = await getWeekData(
      req.userId,
      start,
      end
    );
    const stats = computeWeeklyStats({ days, blocks, plans });
    const summaryLines = buildWeeklySummaryLines(stats);
    res.json({ days, blocks, plans, stats, summaryLines });
  } catch (e) {
    console.error("/api/week error", e);
    res.status(500).json({ error: "주간 데이터를 불러오지 못했습니다." });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json(me);
  } catch (e) {
    console.error("/api/me error", e);
    res.status(500).json({ error: "사용자 정보를 불러오지 못했습니다." });
  }
});

async function handleAccountUpdate(req, res) {
  try {
    const body = req.body || {};
    const currentPassword = String(body.currentPassword || "");
    const emailIn =
      body.email != null ? String(body.email).trim().toLowerCase() : "";
    const newPasswordIn =
      body.newPassword != null ? String(body.newPassword) : "";
    const hasNameKey = Object.prototype.hasOwnProperty.call(body, "name");
    const hasGradeKey = Object.prototype.hasOwnProperty.call(body, "grade");
    const hasGoalKey = Object.prototype.hasOwnProperty.call(body, "goal");

    const user = await getUserByIdForAuth(req.userId);
    if (!user) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }

    const emailChanged =
      emailIn.length > 0 && emailIn !== user.email;
    const passwordChange = newPasswordIn.length > 0;

    if (emailChanged || passwordChange) {
      if (!currentPassword) {
        return res
          .status(400)
          .json({ error: "현재 비밀번호가 올바르지 않습니다." });
      }
      const hash = user.password_hash;
      if (!hash || typeof hash !== "string") {
        return res.status(400).json({
          error:
            "계정에 저장된 비밀번호 정보가 없습니다. 로그아웃 후 다시 로그인해 보세요."
        });
      }
      let passwordMatches = false;
      try {
        passwordMatches = await bcrypt.compare(currentPassword, hash);
      } catch (bcErr) {
        console.error("/api/account bcrypt.compare", bcErr);
        return res.status(400).json({
          error: "비밀번호 확인에 실패했습니다. 다시 시도해 주세요."
        });
      }
      if (!passwordMatches) {
        return res
          .status(400)
          .json({ error: "현재 비밀번호가 올바르지 않습니다." });
      }
    }

    if (emailChanged) {
      const taken = await findUserByEmail(emailIn);
      if (taken && Number(taken.id) !== Number(user.id)) {
        return res.status(400).json({ error: "이미 사용 중인 이메일입니다." });
      }
      await updateUserEmail(req.userId, emailIn);
    }

    if (passwordChange) {
      if (newPasswordIn.length < 4) {
        return res
          .status(400)
          .json({ error: "비밀번호는 4자 이상이어야 합니다." });
      }
      const hash = await bcrypt.hash(newPasswordIn, 10);
      await updateUserPasswordHash(req.userId, hash);
    }

    if ((hasNameKey || hasGradeKey || hasGoalKey) && user.role === "student") {
      const profile = await getStudentCoachProfile(req.userId);
      const profilePatch = {};

      const nameIn = String(body.name ?? "").trim();
      if (hasNameKey) {
        if (nameIn.length > 40) {
          return res.status(400).json({ error: "이름은 40자 이내로 입력해 주세요." });
        }
        if (nameIn.length > 0) {
          profilePatch.name = nameIn;
        }
      }

      let nextGrade = profile?.grade ?? null;
      if (hasGradeKey) {
        const rawGrade = String(body.grade ?? "").trim();
        if (!rawGrade) {
          nextGrade = null;
          profilePatch.grade = null;
        } else {
          const parsedGrade = Number(rawGrade);
          if (
            !Number.isInteger(parsedGrade) ||
            parsedGrade < 1 ||
            parsedGrade > 12
          ) {
            return res.status(400).json({ error: "학년은 1부터 12 사이로 입력해 주세요." });
          }
          nextGrade = parsedGrade;
          profilePatch.grade = parsedGrade;
        }
      }

      let nextGoal = String(profile?.goal || "").trim();
      if (hasGoalKey) {
        const goalIn = String(body.goal ?? "").trim();
        if (goalIn.length > 120) {
          return res.status(400).json({ error: "목표는 120자 이내로 입력해 주세요." });
        }
        nextGoal = goalIn;
        profilePatch.goal = goalIn || null;
      }

      profilePatch.initialProfileCompleted =
        Number.isInteger(Number(nextGrade)) && String(nextGoal).trim().length > 0;

      if (Object.keys(profilePatch).length > 0) {
        await upsertStudentCoachProfile(req.userId, profilePatch);
      }
    }

    const me = await getMe(req.userId);
    res.json({ ok: true, user: me });
  } catch (e) {
    if (e && e.code === "23505") {
      return res.status(400).json({ error: "이미 사용 중인 이메일입니다." });
    }
    console.error("/api/account error", e);
    res.status(500).json({ error: "계정 정보를 저장하지 못했습니다." });
  }
}

/** PUT·POST 둘 다 허용 (일부 프록시·구버전 클라이언트에서 PUT만 404 나는 경우 대비) */
app.put("/api/account", authMiddleware, handleAccountUpdate);
app.post("/api/account", authMiddleware, handleAccountUpdate);

app.post("/api/account/withdraw", authMiddleware, async (req, res) => {
  try {
    const ok = await deleteUser(req.userId);
    if (!ok) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/account/withdraw error", e);
    res.status(500).json({ error: "회원 탈퇴 처리에 실패했습니다." });
  }
});

// 학부모가 연결한 학생 목록
app.get("/api/parent/students", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const students = await listParentStudents(req.userId);
    res.json({ students });
  } catch (e) {
    console.error("/api/parent/students error", e);
    res.status(500).json({ error: "학생 목록을 불러오지 못했습니다." });
  }
});

// 학부모 → 학생 연결 요청 (학생 승인 필요)
app.post("/api/parent/link-request", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const { studentEmail } = req.body || {};
    if (!studentEmail) {
      return res.status(400).json({ error: "studentEmail이 필요합니다." });
    }
    const result = await parentRequestLink(req.userId, studentEmail);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "연결 요청에 실패했습니다." });
    }
    res.json({ ok: true, requestId: result.requestId });
  } catch (e) {
    console.error("/api/parent/link-request error", e);
    res.status(500).json({ error: "연결 요청에 실패했습니다." });
  }
});

// 학부모: 대기 중인 연결 요청 목록
app.get("/api/parent/link-requests", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const data = await listParentLinkRequests(req.userId);
    res.json(data);
  } catch (e) {
    console.error("/api/parent/link-requests error", e);
    res.status(500).json({ error: "목록을 불러오지 못했습니다." });
  }
});

// 학부모: 자녀가 보낸 요청 승인
app.post("/api/parent/link-confirm", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const requestId = Number((req.body || {}).requestId || 0);
    if (!requestId) {
      return res.status(400).json({ error: "requestId가 필요합니다." });
    }
    const result = await parentConfirmLinkRequest(req.userId, requestId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "승인에 실패했습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/parent/link-confirm error", e);
    res.status(500).json({ error: "승인에 실패했습니다." });
  }
});

// 학부모: 자녀가 보낸 오늘 계획 추가 승인 대기 목록
app.get("/api/parent/plan-add-requests", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const requests = await listPendingPlanAddRequestsForParent(req.userId);
    res.json({ requests });
  } catch (e) {
    console.error("/api/parent/plan-add-requests error", e);
    res.status(500).json({ error: "목록을 불러오지 못했습니다." });
  }
});

app.post(
  "/api/parent/plan-add-requests/:id/approve",
  authMiddleware,
  async (req, res) => {
    try {
      const me = await getMe(req.userId);
      if (!me || me.role !== "parent") {
        return res.status(403).json({ error: "권한이 없습니다." });
      }
      const requestId = Number(req.params.id || 0);
      if (!requestId) {
        return res.status(400).json({ error: "요청 id가 필요합니다." });
      }
      const result = await approvePlanAddRequestByParent(
        requestId,
        req.userId
      );
      if (!result.ok) {
        return res.status(400).json({ error: result.error || "승인에 실패했습니다." });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("/api/parent/plan-add-requests/:id/approve error", e);
      res.status(500).json({ error: "승인에 실패했습니다." });
    }
  }
);

app.post(
  "/api/parent/plan-add-requests/:id/reject",
  authMiddleware,
  async (req, res) => {
    try {
      const me = await getMe(req.userId);
      if (!me || me.role !== "parent") {
        return res.status(403).json({ error: "권한이 없습니다." });
      }
      const requestId = Number(req.params.id || 0);
      if (!requestId) {
        return res.status(400).json({ error: "요청 id가 필요합니다." });
      }
      const result = await rejectPlanAddRequestByParent(requestId, req.userId);
      if (!result.ok) {
        return res.status(400).json({ error: result.error || "거절에 실패했습니다." });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("/api/parent/plan-add-requests/:id/reject error", e);
      res.status(500).json({ error: "거절에 실패했습니다." });
    }
  }
);

// 학생 → 학부모 연결 요청 (학부모 승인 필요)
app.post("/api/student/request-parent", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const { parentEmail } = req.body || {};
    if (!parentEmail) {
      return res.status(400).json({ error: "parentEmail이 필요합니다." });
    }
    const result = await studentRequestParent(req.userId, parentEmail);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "연결 요청에 실패했습니다." });
    }
    res.json({ ok: true, requestId: result.requestId });
  } catch (e) {
    console.error("/api/student/request-parent error", e);
    res.status(500).json({ error: "연결 요청에 실패했습니다." });
  }
});

// 학생: 대기 중인 연결 요청 목록
app.get("/api/student/link-requests", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const data = await listStudentLinkRequests(req.userId);
    res.json(data);
  } catch (e) {
    console.error("/api/student/link-requests error", e);
    res.status(500).json({ error: "목록을 불러오지 못했습니다." });
  }
});

// 학생: 연결된 학부모 목록
app.get("/api/student/parents", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const parents = await listStudentParents(req.userId);
    res.json({ parents });
  } catch (e) {
    console.error("/api/student/parents error", e);
    res.status(500).json({ error: "목록을 불러오지 못했습니다." });
  }
});

// 학생: 학부모가 보낸 요청 승인
app.post("/api/student/link-confirm", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const requestId = Number((req.body || {}).requestId || 0);
    if (!requestId) {
      return res.status(400).json({ error: "requestId가 필요합니다." });
    }
    const result = await studentConfirmLinkRequest(req.userId, requestId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "승인에 실패했습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/student/link-confirm error", e);
    res.status(500).json({ error: "승인에 실패했습니다." });
  }
});

// 학생: 오늘 타임라인 추가 → 연결된 학부모에게 승인 요청
app.post("/api/student/plan-add-request", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 요청할 수 있습니다." });
    }
    const { bookId, plannedRange, startTime, endTime, date } = req.body || {};
    const bid = Number(bookId);
    const d = String(date || "")
      .trim()
      .slice(0, 10);
    if (!Number.isFinite(bid) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return res
        .status(400)
        .json({ error: "bookId와 date(YYYY-MM-DD)가 필요합니다." });
    }
    const st = String(startTime || "").trim();
    const et = String(endTime || "").trim();
    if (!st || !et) {
      return res.status(400).json({ error: "시작·종료 시간이 필요합니다." });
    }
    const n = await countLinkedParentsForStudent(req.userId);
    if (n === 0) {
      return res.status(400).json({
        error:
          "연결된 학부모 계정이 없습니다. 프로필에서 학부모와 먼저 연결해 주세요.",
        code: "NO_LINKED_PARENT"
      });
    }
    const bookRow = await getActiveStudyBookForStudent(req.userId, bid);
    if (!bookRow) {
      return res.status(400).json({ error: "책을 찾을 수 없습니다." });
    }
    const name = String(bookRow.name || "").trim() || "과목";
    const row = await createParentPlanAddRequest({
      studentUserId: req.userId,
      targetDate: d,
      bookId: bid,
      plannedRange:
        plannedRange != null ? String(plannedRange) : null,
      startTime: st,
      endTime: et,
      subjectSnapshot: name
    });
    if (!row) {
      return res.status(500).json({ error: "요청을 저장하지 못했습니다." });
    }
    await createParentNotificationForLinkedParents(
      req.userId,
      "오늘 계획 수정 요청",
      `${String(me.email || "학생")}(이)가 ${d} ${st}-${et} ${name}${plannedRange ? ` · ${String(plannedRange).trim()}` : ""} 계획 수정을 요청했어요.`
    );
    res.json({ ok: true, id: row.id });
  } catch (e) {
    console.error("/api/student/plan-add-request error", e);
    res.status(500).json({ error: "요청을 보내지 못했습니다." });
  }
});

// 양쪽 모두: 대기 중 요청 거절
app.post("/api/link/reject", authMiddleware, async (req, res) => {
  try {
    const requestId = Number((req.body || {}).requestId || 0);
    if (!requestId) {
      return res.status(400).json({ error: "requestId가 필요합니다." });
    }
    const result = await rejectLinkRequest(req.userId, requestId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "거절에 실패했습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/link/reject error", e);
    res.status(500).json({ error: "거절에 실패했습니다." });
  }
});

// 특정 학생의 주간 리포트를 학부모가 조회
app.get("/api/parent/week", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number(req.query.studentId || 0);
    const start = String(req.query.start || "").slice(0, 10);
    if (!studentId || !start) {
      return res.status(400).json({ error: "studentId와 start(YYYY-MM-DD)가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) return res.status(403).json({ error: "연결된 학생이 아닙니다." });

    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) {
      return res
        .status(400)
        .json({ error: "start 형식이 올바르지 않습니다. (YYYY-MM-DD)" });
    }
    const endDate = new Date(startDate.getTime());
    endDate.setDate(startDate.getDate() + 6);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

    const { days, blocks, plans } = await getWeekData(studentId, start, end);
    const stats = computeWeeklyStats({ days, blocks, plans });
    const summaryLines = buildWeeklySummaryLines(stats);
    res.json({ days, blocks, plans, stats, summaryLines });
  } catch (e) {
    console.error("/api/parent/week error", e);
    res.status(500).json({ error: "주간 리포트를 불러오지 못했습니다." });
  }
});

// 학부모: 저장된 최신 AI 일일 리포트 (자정 배치로 생성)
app.get("/api/parent/ai-daily-report", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number(req.query.studentId || 0);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const row = await getLatestParentAiReport(req.userId, studentId);
    if (!row) {
      return res.json({
        report: null,
        message:
          "아직 생성된 AI 리포트가 없습니다. 매일 자정(한국시간)에 자동으로 생성됩니다. OPENAI_API_KEY가 서버에 설정되어 있어야 합니다."
      });
    }
    res.json({
      report: {
        summary_text: row.summary_text,
        report_date: row.report_date,
        model: row.model,
        created_at: row.created_at
      }
    });
  } catch (e) {
    console.error("/api/parent/ai-daily-report error", e);
    res.status(500).json({ error: "AI 리포트를 불러오지 못했습니다." });
  }
});

// 학부모: 지금 즉시 AI 리포트 생성 (테스트·수동 갱신, OPENAI_API_KEY 필요)
app.post("/api/parent/ai-daily-report/refresh", authMiddleware, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "서버에 OPENAI_API_KEY가 없습니다."
      });
    }
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number((req.body || {}).studentId || 0);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const result = await runOnePair(req.userId, studentId);
    const row = await getLatestParentAiReport(req.userId, studentId);
    res.json({ ok: true, result, report: row });
  } catch (e) {
    console.error("/api/parent/ai-daily-report/refresh error", e);
    res.status(500).json({
      error: e.message || "AI 리포트 생성에 실패했습니다."
    });
  }
});

// 학부모: 자녀별 계획표 작성 강제 시간 조회
app.get("/api/parent/planner-rule", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number(req.query.studentId || 0);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const rule = await getParentPlannerRule(req.userId, studentId);
    const lockStatus = await getParentLockStatus(req.userId, studentId);
    res.json({
      rule: {
        enabled: Boolean(rule.enabled),
        lockTime: String(rule.lock_time || "21:00").slice(0, 5),
        updatedAt: rule.updated_at
      },
      lockStatus
    });
  } catch (e) {
    console.error("/api/parent/planner-rule GET error", e);
    res.status(500).json({ error: "설정 정보를 불러오지 못했습니다." });
  }
});

// 학부모: 자녀별 계획표 작성 강제 시간 저장
app.put("/api/parent/planner-rule", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number((req.body || {}).studentId || 0);
    const enabled = Boolean((req.body || {}).enabled);
    const lockTime = String((req.body || {}).lockTime || "").slice(0, 5);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    if (!/^\d{2}:\d{2}$/.test(lockTime)) {
      return res.status(400).json({ error: "lockTime 형식(HH:MM)이 올바르지 않습니다." });
    }
    const hh = Number(lockTime.slice(0, 2));
    const mm = Number(lockTime.slice(3, 5));
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return res.status(400).json({ error: "lockTime 값이 올바르지 않습니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const saved = await upsertParentPlannerRule(
      req.userId,
      studentId,
      enabled,
      lockTime
    );
    const lockStatus = await getParentLockStatus(req.userId, studentId);
    res.json({
      ok: true,
      rule: {
        enabled: Boolean(saved.enabled),
        lockTime: String(saved.lock_time).slice(0, 5),
        updatedAt: saved.updated_at
      },
      lockStatus
    });
  } catch (e) {
    console.error("/api/parent/planner-rule PUT error", e);
    res.status(500).json({ error: "설정 저장에 실패했습니다." });
  }
});

app.get("/api/student/lock-status", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const lockStatus = await getStudentLockStatus(req.userId);
    res.json({ lockStatus });
  } catch (e) {
    console.error("/api/student/lock-status error", e);
    res.status(500).json({ error: "잠금 상태를 불러오지 못했습니다." });
  }
});

app.get("/api/student/notifications/summary", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const unreadCount = await countUnreadStudentNotifications(req.userId);
    res.json({ unreadCount });
  } catch (e) {
    console.error("/api/student/notifications/summary error", e);
    res.status(500).json({ error: "알림 상태를 불러오지 못했습니다." });
  }
});

app.get("/api/student/notifications", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const notifications = await listStudentNotifications(req.userId);
    res.json({ notifications });
  } catch (e) {
    console.error("/api/student/notifications error", e);
    res.status(500).json({ error: "알림 목록을 불러오지 못했습니다." });
  }
});

app.post("/api/student/notifications/read-all", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    await markStudentNotificationsReadAll(req.userId);
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/student/notifications/read-all error", e);
    res.status(500).json({ error: "알림 읽음 처리에 실패했습니다." });
  }
});

app.get("/api/parent/notifications/summary", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const unreadCount = await countUnreadParentNotifications(req.userId);
    res.json({ unreadCount });
  } catch (e) {
    console.error("/api/parent/notifications/summary error", e);
    res.status(500).json({ error: "알림 상태를 불러오지 못했습니다." });
  }
});

app.get("/api/parent/notifications", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const notifications = await listParentNotifications(req.userId);
    res.json({ notifications });
  } catch (e) {
    console.error("/api/parent/notifications error", e);
    res.status(500).json({ error: "알림 목록을 불러오지 못했습니다." });
  }
});

app.post("/api/parent/notifications/read-all", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    await markParentNotificationsReadAll(req.userId);
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/parent/notifications/read-all error", e);
    res.status(500).json({ error: "알림 읽음 처리에 실패했습니다." });
  }
});

app.get("/api/parent/lock-status", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number(req.query.studentId || 0);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const lockStatus = await getParentLockStatus(req.userId, studentId);
    res.json({ lockStatus });
  } catch (e) {
    console.error("/api/parent/lock-status error", e);
    res.status(500).json({ error: "잠금 상태를 불러오지 못했습니다." });
  }
});

app.post("/api/parent/lock-now", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number((req.body || {}).studentId || 0);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const session = await forceParentLock(req.userId, studentId);
    const lockStatus = await getParentLockStatus(req.userId, studentId);
    res.json({ ok: true, session, lockStatus });
  } catch (e) {
    console.error("/api/parent/lock-now error", e);
    res.status(500).json({ error: "수동 잠금에 실패했습니다." });
  }
});

app.post("/api/parent/unlock-now", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const studentId = Number((req.body || {}).studentId || 0);
    if (!studentId) {
      return res.status(400).json({ error: "studentId가 필요합니다." });
    }
    const has = await parentHasStudent(req.userId, studentId);
    if (!has) {
      return res.status(403).json({ error: "연결된 학생이 아닙니다." });
    }
    const session = await forceParentUnlock(req.userId, studentId);
    const lockStatus = await getParentLockStatus(req.userId, studentId);
    res.json({ ok: true, session, lockStatus });
  } catch (e) {
    console.error("/api/parent/unlock-now error", e);
    res.status(500).json({ error: "수동 해제에 실패했습니다." });
  }
});

// 학생: 학습 앱스토어 목록 + 내 설치 상태
app.get("/api/student/store-apps", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const apps = await listStoreAppsForUser(req.userId);
    res.json({
      apps: apps.map(app => ({
        id: app.app_key,
        name: app.name,
        category: app.category,
        description: app.description,
        url: app.url,
        installed: Boolean(app.is_installed),
        installedAt: app.installed_at,
        removedAt: app.removed_at,
        updatedAt: app.updated_at
      }))
    });
  } catch (e) {
    console.error("/api/student/store-apps GET error", e);
    res.status(500).json({ error: "앱 목록을 불러오지 못했습니다." });
  }
});

app.get("/api/student/coach/state", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const profile = await getStudentCoachProfile(req.userId);
    const weekStart = String(req.query.weekStart || "").trim();
    const logs =
      weekStart && isIsoDate(weekStart)
        ? await listStudentCoachLogsInWeekRange(req.userId, weekStart)
        : await listRecentStudentCoachLogs(req.userId, 21);
    const snapshot = buildCoachSnapshot(profile, logs);
    res.json({
      snapshot,
      logs: logs.map(r => ({
        date: formatPgLogDate(r.log_date),
        sleepHours: r.sleep_hours,
        concentrationScore: r.concentration_score,
        stressScore: r.stress_score,
        steps: r.steps,
        planCompletionRate: r.plan_completion_rate,
        studyMinutes: r.study_minutes,
        memo: r.memo,
        tomorrowPractice: r.tomorrow_practice,
        tomorrowPracticeDone: r.tomorrow_practice_done,
        studyEvaluation: r.study_evaluation,
        metacognitionReflection: r.metacognition_reflection
      }))
    });
  } catch (e) {
    console.error("/api/student/coach/state error", e);
    res.status(500).json({ error: "코치 상태를 불러오지 못했습니다." });
  }
});

app.get("/api/student/coach/pattern-insights", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const weekStart = String(req.query.weekStart || "").trim();
    const logs =
      weekStart && isIsoDate(weekStart)
        ? await listStudentCoachLogsInWeekRange(req.userId, weekStart)
        : await listRecentStudentCoachLogs(req.userId, 21);
    const rhythmWeek = buildWeekRhythmPayloadFromLogs(
      logs,
      weekStart && isIsoDate(weekStart) ? weekStart : null
    );
    const recordedDays = rhythmWeek.filter(
      d =>
        d.sleepHours != null ||
        d.studyMinutes != null ||
        d.concentrationScore != null ||
        d.stressScore != null ||
        d.planCompletionRate != null
    ).length;

    if (!openai) {
      return res.json({
        patterns: [],
        usedOpenAi: false,
        rhythmWeek,
        recordedDayCount: recordedDays
      });
    }

    const payload = {
      weekRhythm: rhythmWeek,
      recordedDayCount: recordedDays,
      basisMetrics: [
        "sleepHours",
        "stressScore",
        "concentrationPercent",
        "studyMinutes",
        "planCompletionRate"
      ],
      fieldHelp: {
        sleepHours: "시간, 미기록은 null",
        stressScore: "1~5 (높을수록 스트레스 큼)",
        concentrationPercent: "대략 0~100 환산",
        studyMinutes: "분",
        planCompletionRate: "0~100"
      }
    };

    const { parsed, rawText } = await openAiPatternCompletion(payload);
    if (!parsed || !Array.isArray(parsed.patterns)) {
      console.warn(
        "[pattern-insights] JSON 파싱 실패, 응답 앞 240자:",
        String(rawText || "").slice(0, 240)
      );
      return res.status(502).json({
        error:
          "AI 응답 형식이 맞지 않습니다. 잠시 후 다시 시도하거나 OPENAI_MODEL을 gpt-4o-mini로 두고 확인해 주세요."
      });
    }
    let patterns = sanitizeAiPatterns(parsed.patterns);
    if (recordedDays >= 2) {
      patterns = patterns.filter(p => !looksLikeInsufficientPattern(p));
    }
    if (patterns.length === 0) {
      patterns = [buildRhythmFallbackPattern(rhythmWeek, recordedDays)];
    }
    res.json({
      patterns,
      usedOpenAi: true,
      model: OPENAI_MODEL,
      rhythmWeek,
      recordedDayCount: recordedDays
    });
  } catch (e) {
    console.error("/api/student/coach/pattern-insights error", e);
    res.status(500).json({ error: "패턴 분석에 실패했습니다." });
  }
});

app.put("/api/student/coach/profile", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const input = req.body || {};
    const profileInput = {
      name: toNullableString(input.name, 40),
      schoolLevel: toNullableString(input.schoolLevel, 10),
      grade: toNullableNumber(input.grade, 1, 12),
      goal: toNullableString(input.goal, 200),
      targetSubjects: sanitizeStringArray(input.targetSubjects, 10, 30),
      weakSubjects: sanitizeStringArray(input.weakSubjects, 10, 30),
      sleepTime: /^\d{2}:\d{2}$/.test(String(input.sleepTime || ""))
        ? String(input.sleepTime)
        : null,
      wakeTime: /^\d{2}:\d{2}$/.test(String(input.wakeTime || ""))
        ? String(input.wakeTime)
        : null
    };
    const saved = await upsertStudentCoachProfile(req.userId, profileInput);
    res.json({ ok: true, profile: saved });
  } catch (e) {
    console.error("/api/student/coach/profile error", e);
    res.status(500).json({ error: "프로필 저장에 실패했습니다." });
  }
});

app.post("/api/student/coach/log", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const body = req.body || {};
    /*
     * '오늘 기록'은 클라이언트 date를 쓰지 않음.
     * (1) toISOString() 폴백 등으로 서버가 UTC 일자를 쓰면 한국 4/5인데 4/4로 저장됨
     * (2) 기기 Intl/타임존과 PG 서울 달력 불일치 방지
     * log_date는 DB COALESCE(..., (now() AT TIME ZONE 'Asia/Seoul')::date)로만 결정.
     */
    const logInput = {
      date: null,
      sleepHours: toNullableNumber(body.sleepHours, 0, 24),
      steps: toNullableNumber(body.steps, 0, 200000),
      mealsRegularity: toNullableNumber(body.mealsRegularity, 1, 5),
      concentrationScore: toNullableNumber(body.concentrationScore, 1, 5),
      stressScore: toNullableNumber(body.stressScore, 1, 5),
      phoneDistractions: toNullableNumber(body.phoneDistractions, 0, 300),
      studyMinutes: toNullableNumber(body.studyMinutes, 0, 1440),
      planCompletionRate: toNullableNumber(body.planCompletionRate, 0, 100),
      memo: toNullableString(body.memo, 1000),
      tomorrowPractice: toNullableString(body.tomorrowPractice, 500),
      studyEvaluation: toNullableString(body.studyEvaluation, 1000),
      metacognitionReflection: toNullableString(body.metacognitionReflection, 2000)
    };
    if (Object.prototype.hasOwnProperty.call(body, "tomorrowPracticeDone")) {
      logInput.tomorrowPracticeDone =
        body.tomorrowPracticeDone === null || body.tomorrowPracticeDone === undefined
          ? null
          : Boolean(body.tomorrowPracticeDone);
    }
    const row = await upsertStudentCoachLog(req.userId, logInput);
    const logOut =
      row && typeof row === "object"
        ? { ...row, log_date: formatPgLogDate(row.log_date) }
        : row;
    res.json({ ok: true, log: logOut });
  } catch (e) {
    console.error("/api/student/coach/log error", e);
    res.status(500).json({ error: "학습 로그 저장에 실패했습니다." });
  }
});

app.post("/api/student/coach/app-timetable", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }

    const serialFromBody = String((req.body || {}).serial || "").trim();
    if (isLikelySerial(serialFromBody)) {
      await linkDeviceToUserBySerial(req.userId, serialFromBody).catch(() => {
        // ignore
      });
    }
    await attachDeviceByCookieIfPresent(req, req.userId).catch(() => {
      // ignore
    });

    const todayKey = formatYmdSeoulFromInstant(new Date());
    const tomorrowKey = addDaysToSeoulDateKey(todayKey, 1);
    const [scheduleRows, books, linkedSerial] = await Promise.all([
      listStudentProfileSchedules(req.userId),
      listStudyBooks(req.userId),
      getActiveDeviceSerialForUser(req.userId)
    ]);

    const tomorrowSchedules = (scheduleRows || []).filter(row =>
      scheduleOccursOnDate(row, tomorrowKey)
    );
    let installedApps = [];
    if (linkedSerial) {
      const device = await findDeviceBySerial(linkedSerial).catch(() => null);
      if (device?.id) {
        const simpleMdmApps = await listInstalledAppsForDevice(Number(device.id)).catch(
          () => []
        );
        installedApps = normalizeInstalledAppsForPrompt(simpleMdmApps);
      }
    }
    const draftPlans = normalizeTomorrowPlanDraft((req.body || {}).planDraft, books);
    let tomorrowPlans = draftPlans;
    if (tomorrowPlans.length === 0) {
      const data = await getStudyPlansForDate(req.userId, tomorrowKey);
      tomorrowPlans = (Array.isArray(data?.plans) ? data.plans : []).map(item => ({
        bookId: Number(item.book_id || 0) || null,
        bookName: String(item.book_name || "").trim(),
        plannedRange: String(item.planned_range || "").trim(),
        startTime: String(item.start_time || "").trim().slice(0, 5),
        endTime: String(item.end_time || "").trim().slice(0, 5)
      }));
    }

    const plan = await generateStudentAppAllowancePlan({
      tomorrowKey,
      tomorrowSchedules,
      tomorrowPlans,
      installedApps
    });

    res.json({
      ok: true,
      targetDate: tomorrowKey,
      schedulesCount: tomorrowSchedules.length,
      installedAppsCount: installedApps.length,
      availableApps: installedApps,
      summary: plan.summary,
      slots: plan.slots,
      usedOpenAi: plan.usedOpenAi,
      model: plan.model
    });
  } catch (e) {
    console.error("/api/student/coach/app-timetable error", e);
    res.status(500).json({ error: "앱 허용 시간표 생성에 실패했습니다." });
  }
});

app.post("/api/student/coach/app-timetable-request", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "학생만 요청할 수 있습니다." });
    }

    const linkedParentCount = await countLinkedParentsForStudent(req.userId);
    if (linkedParentCount === 0) {
      return res.status(400).json({
        error:
          "연결된 학부모 계정이 없습니다. 프로필에서 학부모와 먼저 연결해 주세요.",
        code: "NO_LINKED_PARENT"
      });
    }

    const requestedDate = String((req.body || {}).targetDate || "")
      .trim()
      .slice(0, 10);
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : addDaysToSeoulDateKey(formatYmdSeoulFromInstant(new Date()), 1);
    const summary = String((req.body || {}).summary || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 180);
    const slotSummary = Array.isArray((req.body || {}).slots)
      ? req.body.slots
          .slice(0, 3)
          .map(slot => {
            const start = String(slot?.startTime || "").trim().slice(0, 5);
            const end = String(slot?.endTime || "").trim().slice(0, 5);
            const title = String(slot?.title || "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 40);
            if (!start || !end) return title || null;
            return title ? `${start}-${end} ${title}` : `${start}-${end}`;
          })
          .filter(Boolean)
          .join(", ")
      : "";

    const bodyParts = [
      `${String(me.email || "학생")}(이)가 ${targetDate} 앱 허용 시간표 확인을 요청했어요.`
    ];
    if (summary) bodyParts.push(summary);
    if (slotSummary) bodyParts.push(`추천 시간대: ${slotSummary}`);

    await createParentNotificationForLinkedParents(
      req.userId,
      "내일 앱 허용 시간표 요청",
      bodyParts.join(" ").slice(0, 400)
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("/api/student/coach/app-timetable-request error", e);
    res.status(500).json({ error: "요청을 보내지 못했습니다." });
  }
});

/** 오늘 날짜 로그의 tomorrow_practice만 갱신 (코치 내일 실천 반영) */
app.patch("/api/student/coach/log/tomorrow-practice", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const raw = (req.body || {}).tomorrowPractice;
    const text =
      raw === null || raw === undefined
        ? null
        : String(raw).trim().slice(0, 500) || null;
    const row = await setStudentCoachLogTomorrowPractice(req.userId, text);
    const logOut =
      row && typeof row === "object"
        ? { ...row, log_date: formatPgLogDate(row.log_date) }
        : row;
    res.json({ ok: true, log: logOut });
  } catch (e) {
    console.error("/api/student/coach/log/tomorrow-practice PATCH error", e);
    res.status(500).json({ error: "내일 실천 저장에 실패했습니다." });
  }
});

async function handleStudentTomorrowPracticeDone(req, res) {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const raw = (req.body || {}).done;
    if (raw !== true && raw !== false) {
      return res.status(400).json({ error: "done은 true 또는 false여야 합니다." });
    }
    const row = await setStudentCoachLogTomorrowPracticeDone(req.userId, raw);
    const logOut =
      row && typeof row === "object"
        ? { ...row, log_date: formatPgLogDate(row.log_date) }
        : row;
    res.json({ ok: true, log: logOut });
  } catch (e) {
    console.error("/api/student/coach/log/tomorrow-practice-done error", e);
    res.status(500).json({ error: "실천 여부 저장에 실패했습니다." });
  }
}

app.patch(
  "/api/student/coach/log/tomorrow-practice-done",
  authMiddleware,
  handleStudentTomorrowPracticeDone
);
app.post(
  "/api/student/coach/log/tomorrow-practice-done",
  authMiddleware,
  handleStudentTomorrowPracticeDone
);

app.post("/api/student/coach/chat", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const text = String((req.body || {}).message || "")
      .trim()
      .slice(0, 1200);
    if (!text) {
      return res.status(400).json({ error: "message가 필요합니다." });
    }
    const rawMode = String((req.body || {}).mode || "").trim().toLowerCase();
    const chatMode =
      rawMode === "suneung"
        ? "suneung"
        : rawMode === "schedule"
          ? "schedule"
          : "learning";

    await insertStudentCoachMessage(req.userId, "user", text);

    const profile = await getStudentCoachProfile(req.userId);
    const logs = await listRecentStudentCoachLogs(req.userId, 14);
    const history = await listRecentStudentCoachMessages(req.userId, 12);
    const snapshot = buildCoachSnapshot(profile, logs);
    const existingScheduleRows = await listStudentProfileSchedules(req.userId);
    const existingSchedules = serializeScheduleRowsForPrompt(existingScheduleRows);
    const todayDateKey = formatYmdSeoulFromInstant(new Date());
    const tomorrowDateKey = addDaysToSeoulDateKey(todayDateKey, 1);
    const todayWeekdayKorean = getKoreanWeekdayNameFromIsoDate(todayDateKey);
    const tomorrowWeekdayKorean = getKoreanWeekdayNameFromIsoDate(tomorrowDateKey);
    const weekStartDateKey = addDaysToSeoulDateKey(todayDateKey, -6);
    const recentWeekData = await getWeekData(req.userId, weekStartDateKey, todayDateKey);
    const coachDbContext = buildPersistentCoachDbContext({
      me,
      profile,
      snapshot,
      recentLogs: logs,
      existingScheduleRows,
      weekData: recentWeekData
    });

    if (chatMode === "schedule" || isScheduleManagementRequest(text)) {
      if (openai) {
        const response = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          temperature: 0.3,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                `너는 한국 학생의 일정 관리를 도와주는 AI 코치다. 오늘 날짜는 ${formatYmdSeoulFromInstant(new Date())} 이다. 항상 한국어로 답하고 반드시 JSON 객체만 출력한다. 형식은 {"action":"inquire"|"create_schedule"|"update_schedule"|"delete_schedule"|"cancel_pending","message":"학생에게 보여줄 자연스러운 답변","schedule":null|{"title":"일정 제목","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","isRecurring":true|false,"recurrenceRule":"반복 설명 또는 빈 문자열","note":"보충 메모 또는 빈 문자열"},"targetScheduleId":null|number} 이다. create_schedule과 update_schedule은 일정 제목, 날짜, 시작 시간, 종료 시간이 모두 확실할 때만 사용한다. 이 중 하나라도 확실하지 않으면 반드시 inquire를 사용하고, 빠진 정보만 짧게 다시 물어본다. 종료 시간이 없으면 절대 생성하거나 수정하지 않는다. 반복 일정이면 recurrenceRule도 반드시 채운다. 기존 일정과 시간이 겹치더라도 사용자가 '같은 일정이다', '이름만 바꿔 달라', '기존 일정 수정이다'라고 분명히 말하면 create_schedule 대신 update_schedule을 사용한다. 일정이 취소됐다고 하거나 삭제해 달라고 하면 delete_schedule을 사용한다. 사용자가 방금 추가하려던 일정 자체를 접거나 말을 바꾼 경우, 예를 들면 '아니 그거 말고', '안 하기로 했어', '추가 안 할래' 같은 말이면 delete_schedule이 아니라 cancel_pending을 사용한다. cancel_pending은 아직 저장되지 않은 현재 대화상의 일정 초안을 그만두는 뜻이다. update_schedule과 delete_schedule일 때는 targetScheduleId에 수정/삭제할 기존 일정 id를 넣는다. 애매하면 추정하지 말고 다시 물어본다. 첫 질문은 반복 일정인지 단일 일정인지부터 묻고, 후속 대화에서도 정보가 부족하면 생성하거나 수정하거나 삭제하지 않는다. message는 학생에게 직접 보여질 짧고 자연스러운 문장이다.`
            },
            {
              role: "system",
              content: `학생 DB 컨텍스트(JSON): ${JSON.stringify(coachDbContext)}`
            },
            {
              role: "system",
              content: `현재 등록된 일정 목록: ${JSON.stringify(existingSchedules)}`
            },
            ...history.map(m => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content
            }))
          ]
        });
        const rawReply = String(response.choices?.[0]?.message?.content || "").trim();
        const parsedReply = parseJsonObjectFromAssistantText(rawReply);
        const latestResetRequest = isScheduleDraftResetRequest(text);
        const parsedAction = latestResetRequest
          ? "cancel_pending"
          : String(parsedReply?.action || "");
        const normalizedSchedule = normalizeScheduleDraft(parsedReply?.schedule);
        const accumulatedSchedule = accumulateScheduleDraft(history, text, normalizedSchedule);
        const normalizedScheduleUpdate = normalizeScheduleUpdateDraft({
          scheduleId: parsedReply?.targetScheduleId,
          schedule: accumulatedSchedule
        });
        const missingFields = getMissingScheduleFields(accumulatedSchedule);
        const hasExplicitEndTimeInfo = conversationHasExplicitEndTimeInfo(history, text);
        if (!hasExplicitEndTimeInfo && !missingFields.includes("종료 시간")) {
          missingFields.push("종료 시간");
        }
        const isDeleteAction = parsedAction === "delete_schedule";
        const isCancelPendingAction = parsedAction === "cancel_pending";
        const mustInquire =
          !["create_schedule", "update_schedule", "delete_schedule", "cancel_pending"].includes(
            parsedAction
          ) ||
          (!isDeleteAction && !isCancelPendingAction && missingFields.length > 0) ||
          (isDeleteAction && (!Number.isFinite(Number(parsedReply?.targetScheduleId)) || Number(parsedReply?.targetScheduleId) <= 0));
        const replyText = String(
          isCancelPendingAction
            ? await generateScheduleValidationReply({
                scenario: "intent_reset",
                userText: text,
                draft: accumulatedSchedule,
                snapshot,
                existingSchedules
              }) ||
              parsedReply?.message ||
              "알겠어. 방금 이야기하던 일정은 추가하지 않을게. 다른 일정이 있으면 새로 말해줘."
            : mustInquire
            ? await generateScheduleValidationReply({
                scenario: "missing_fields",
                userText: text,
                missingFields,
                draft: accumulatedSchedule,
                snapshot,
                existingSchedules
              }) || buildMissingScheduleFieldsMessage(missingFields)
            : parsedReply?.message || "일정을 저장할게요."
        ).trim();
        if (!replyText) {
          return res.status(502).json({
            error: "GPT 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요."
          });
        }
        let savedSchedule = null;
        let scheduleChanged = false;
        if (!mustInquire && !isCancelPendingAction && (accumulatedSchedule || isDeleteAction)) {
          if (isDeleteAction) {
            const deleteCandidates = findDeleteCandidatesFromText(text, existingScheduleRows);
            if (deleteCandidates.length > 1) {
              const ambiguousReply =
                (await generateScheduleValidationReply({
                  scenario: "ambiguous_delete",
                  userText: text,
                  candidates: serializeScheduleRowsForPrompt(deleteCandidates),
                  snapshot,
                  existingSchedules
                })) || buildAmbiguousDeleteMessage(deleteCandidates);
              await insertStudentCoachMessage(req.userId, "assistant", ambiguousReply);
              return res.json({
                ok: true,
                reply: ambiguousReply,
                responseType: "schedule_delete_ambiguous",
                usedOpenAi: true,
                model: OPENAI_MODEL
              });
            }
            const targetScheduleId =
              deleteCandidates.length === 1
                ? Number(deleteCandidates[0].id)
                : Number(parsedReply?.targetScheduleId);
            const targetScheduleRow = existingScheduleRows.find(
              row => Number(row.id) === targetScheduleId
            );
            const referencedDate = extractReferencedDateFromText(text);
            if (targetScheduleRow?.is_recurring && referencedDate) {
              const cancelled = await cancelStudentProfileScheduleOccurrence(
                req.userId,
                targetScheduleId,
                referencedDate
              );
              if (cancelled) {
                savedSchedule = serializeStudentProfileSchedule(cancelled);
                scheduleChanged = true;
              }
            } else {
              const deleted = await deleteStudentProfileSchedule(req.userId, targetScheduleId);
              if (deleted) {
                scheduleChanged = true;
              }
            }
            if (savedSchedule || scheduleChanged) {
              scheduleChanged = true;
            }
          } else if (parsedAction === "update_schedule" && normalizedScheduleUpdate) {
            const conflicts = findScheduleConflicts(existingScheduleRows, normalizedScheduleUpdate.schedule, {
              ignoreScheduleId: normalizedScheduleUpdate.scheduleId
            });
            if (conflicts.length > 0) {
              const conflictReply =
                (await generateScheduleValidationReply({
                  scenario: "conflict",
                  userText: text,
                  conflicts,
                  draft: normalizedScheduleUpdate.schedule,
                  snapshot,
                  existingSchedules
                })) ||
                buildScheduleConflictMessage(
                  normalizedScheduleUpdate.schedule,
                  conflicts
                );
              await insertStudentCoachMessage(req.userId, "assistant", conflictReply);
              return res.json({
                ok: true,
                reply: conflictReply,
                responseType: "schedule_conflict",
                usedOpenAi: true,
                model: OPENAI_MODEL,
                conflicts
              });
            }
            const updated = await updateStudentProfileSchedule(
              req.userId,
              normalizedScheduleUpdate.scheduleId,
              normalizedScheduleUpdate.schedule
            );
            if (updated) {
              savedSchedule = serializeStudentProfileSchedule(updated);
              scheduleChanged = true;
            }
          } else {
            const conflicts = findScheduleConflicts(existingScheduleRows, accumulatedSchedule);
            if (conflicts.length > 0) {
              const conflictReply =
                (await generateScheduleValidationReply({
                  scenario: "conflict",
                  userText: text,
                  conflicts,
                  draft: accumulatedSchedule,
                  snapshot,
                  existingSchedules
                })) ||
                buildScheduleConflictMessage(
                  accumulatedSchedule,
                  conflicts
                );
              await insertStudentCoachMessage(req.userId, "assistant", conflictReply);
              return res.json({
                ok: true,
                reply: conflictReply,
                responseType: "schedule_conflict",
                usedOpenAi: true,
                model: OPENAI_MODEL,
                conflicts
              });
            }
            const created = await createStudentProfileSchedule(req.userId, {
              title: accumulatedSchedule.title,
              date: accumulatedSchedule.date,
              startTime: accumulatedSchedule.startTime,
              endTime: accumulatedSchedule.endTime,
              isRecurring: accumulatedSchedule.isRecurring,
              recurrenceRule: accumulatedSchedule.recurrenceRule,
              source: "ai",
              note: accumulatedSchedule.note
            });
            if (created) {
              savedSchedule = serializeStudentProfileSchedule(created);
              scheduleChanged = true;
            }
          }
        }
        await insertStudentCoachMessage(req.userId, "assistant", replyText);
        return res.json({
          ok: true,
          reply: replyText,
          responseType: "schedule_management",
          usedOpenAi: true,
          model: OPENAI_MODEL,
          schedule: savedSchedule,
          scheduleChanged
        });
      }

      const replyText = buildScheduleManagementReply();
      await insertStudentCoachMessage(req.userId, "assistant", replyText);
      return res.json({
        ok: true,
        reply: replyText,
        responseType: "schedule_management_template",
        usedOpenAi: false,
        model: null
      });
    }

    const systemLearning =
      "너는 한국 학생 전용 학습 코치다. 실제 상위권 입시 코치처럼 학생과 대화하되, 항상 한국어 존댓말로 답한다. 아래로 전달되는 학생 DB 컨텍스트(학생 이름/목표/날짜별 기록/개인 일정)를 참고해 개인화하되, 질문과 직접 관련 없는 정보는 억지로 끼워 넣지 않는다. 의학적 진단·자해 조장·시험 부정행위는 거절한다. 답변은 고정 템플릿(예: 1) 원인 분석 2) 우선순위 ...)을 쓰지 말고 자연스러운 대화문으로 작성한다. 문단은 1~3개, 보통 3~7문장으로 짧고 밀도 있게 답한다. 먼저 학생의 현재 상태를 한 문장으로 짚고, 바로 실행 가능한 다음 행동 1~2개를 구체적으로 제안한 뒤, 필요한 경우에만 확인 질문을 1개 덧붙인다. 같은 문장 패턴을 반복하지 말고 상황에 맞게 말투와 흐름을 바꿔라.";
    const systemSuneung =
      "너는 수능(대학수학능력시험) 범위에서 학생과 질의응답하는 과목 코치다. 국어·수학·영어·탐구 등 과목별로 (1) 처음 배우는 개념 (2) 비슷해서 헷갈리는 개념 (3) 풀이가 막히거나 모르는 문제·유형에 대해 학생이 질문하면, 정의·차이·풀이 접근을 짧고 명확히 설명한다. 필요하면 예시·비유·풀이 단계(힌트)를 덧붙인다. 항상 한국어 존댓말. 아래로 전달되는 학생 DB 컨텍스트(학생 이름/목표/날짜별 기록/개인 일정)를 참고해 설명 난이도와 예시를 맞추되, 질문과 직접 관련 없는 내용은 최소화한다. 정당한 학습 범위 안에서만 답한다. 특정 시험의 정답·문제지 유출·답안 그대로 알려 달라는 요청·시험 부정행위 조력은 거절한다. 의학적 진단·자해 조장은 거절한다. 답 형식은 질문에 맞게 가되, 보통 ①핵심 설명 ②헷갈릴 때 구분 포인트 또는 풀이 단계 ③스스로 확인할 질문 한 가지 순으로 짧게 맞춘다.";

    let replyText = "";
    let usedOpenAi = false;
    if (openai) {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: chatMode === "suneung" ? systemSuneung : systemLearning
          },
          {
            role: "system",
            content:
              `시간 기준은 반드시 한국/서울(KST)이다. 오늘은 ${todayDateKey}(${todayWeekdayKorean}요일), 내일은 ${tomorrowDateKey}(${tomorrowWeekdayKorean}요일)이다. 날짜/요일을 답변에 쓸 때는 이 기준만 사용하고, 확실하지 않으면 추정하지 말고 짧게 확인 질문을 해라.`
          },
          {
            role: "system",
            content: `학생 DB 컨텍스트(JSON): ${JSON.stringify(coachDbContext)}`
          },
          ...history.map(m => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content
          }))
        ]
      });
      replyText = String(response.choices?.[0]?.message?.content || "").trim();
      usedOpenAi = true;
      if (!replyText) {
        return res.status(502).json({
          error: "GPT 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요."
        });
      }
    } else {
      if (chatMode === "suneung") {
        replyText = [
          "1) 핵심 안내",
          "- 수능 질문 모드에서는 과목(국어·수학·영어·탐구 등)과 함께, 모르는 개념·헷갈리는 개념·막히는 문제를 그대로 질문해 주세요. 그에 맞춰 정의·구분·풀이 접근을 설명해 드릴 수 있어요.",
          "",
          "2) 참고",
          `- 최근 기록 요약: ${snapshot.heroNarrative}`,
          "",
          "3) 질문 예시",
          "- 「미적에서 극한이랑 연속이 헷갈려요」「이 문장 5형식인지 도치인지 모르겠어요」「이 그래프 문제 식부터 못 세우겠어요」처럼 적어 주시면 됩니다.",
          "",
          "4) 안내",
          "- GPT가 연결되면 더 구체적으로 답해 드릴 수 있어요. 정답만 알려 달라는 식의 요청은 도와드리기 어려워요."
        ].join("\n");
      } else {
        const topAction = snapshot.nextActions[0] || "첫 25분만 하는 블록부터 시작해 보세요.";
        replyText = [
          `${snapshot.heroNarrative} 흐름으로 보여요.`,
          `오늘은 욕심내기보다 ${topAction}`,
          "완벽하게 하려 하기보다 시작 난도를 낮추면 집중이 더 빨리 살아납니다. 지금 바로 시작할 수 있는 가장 짧은 과제 하나를 정해볼까요?"
        ].join("\n\n");
      }
    }

    await insertStudentCoachMessage(req.userId, "assistant", replyText);
    res.json({
      ok: true,
      reply: replyText,
      responseType: usedOpenAi ? "openai" : "template",
      usedOpenAi,
      model: usedOpenAi ? OPENAI_MODEL : null
    });
  } catch (e) {
    console.error("/api/student/coach/chat error", e);
    res.status(500).json({ error: "코치 답변 생성에 실패했습니다." });
  }
});

function extractJsonArrayFromModelText(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fence ? fence[1].trim() : t;
  try {
    const parsed = JSON.parse(inner);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonObjectFromModelText(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fence ? fence[1].trim() : t;
  try {
    const parsed = JSON.parse(inner);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 학생 코치: 내일 계획 협업 대화 */
app.post("/api/student/coach/tomorrow-plan/message", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const body = req.body || {};
    const message = String(body.message || "").trim().slice(0, 2000);
    const context = body.context;
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) {
      return res.status(400).json({ error: "message가 필요합니다." });
    }
    if (!context || typeof context !== "object") {
      return res.status(400).json({ error: "context가 필요합니다." });
    }
    const hist = history.slice(-24).map(h => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: String(h.content || "").slice(0, 6000)
    }));

    const focus = context.collabFocus === "life" ? "life" : "study";
    const systemBlock =
      focus === "life"
        ? `너는 한국 중·고등학생의 '내일 실천할 한 가지'를 기록 탭에 적을 문장으로 함께 다듬는 AI 코치다.
규칙:
- 항상 한국어 존댓말로, 짧고 구체적으로 답한다.
- 아래 JSON의 오늘 생활 좋았던 점과 나빴던 점(memo)·기록한 학습 시간(todayStudyMinutes)·지금 적어 둔 내일 실천 초안(draftTomorrowPractice)을 근거로, 실행 가능한 한 가지 실천을 한 문장~두 문장으로 정하도록 질문하거나 제안한다.
- 하루 전체 시간표·루틴을 쭉 짜는 것이 아니라, '내일 실천할 한 가지' 하나에만 집중한다.
- 의학적 진단·자해 조장·시험 부정행위는 거절한다.

[학생 상황 JSON]
${JSON.stringify(context)}`
        : `너는 한국 중·고등학생의 '내일 학습 계획'을 함께 세우는 AI 코치다.
규칙:
- 항상 한국어 존댓말로, 짧고 구체적으로 답한다.
- 아래 JSON(학생 상황)의 오늘 이행률·시간표 칸·기록한 학습 시간(todayStudyMinutes)·오늘 공부 좋았던 점과 나빴던 점(studyEvaluation)·오늘 공부한 내용 설명(metacognitionReflection)·책별 초안 내일 계획을 근거로 내일 범위(쪽·단원·문항)와 시간을 질문하거나 제안한다.
- 한 번에 한두 가지만 묻거나 제안한다.
- 의학적 진단·자해 조장·시험 부정행위는 거절한다.

[학생 상황 JSON]
${JSON.stringify(context)}`;

    if (!openai) {
      if (focus === "life") {
        const replyText =
          "오늘 생활을 돌아보며, 내일 꼭 한 가지 실천으로 남기고 싶은 것이 있으신가요? 한 문장으로만 적어 보시면 기록 탭「내일 실천할 한 가지」에 맞춰 다듬어 드릴게요. (GPT 연결 시 더 구체적으로 도와드릴 수 있어요.)";
        return res.json({ ok: true, reply: replyText, usedOpenAi: false, model: null });
      }
      const pct = Number(context.todayProgressPercent) || 0;
      const replyText = `오늘 계획 칸 기준 이행률이 ${pct}%로 보입니다. 내일은 가장 먼저 다루고 싶은 교재 한 권 이름과, 그날 목표로 삼을 공부 범위(예: 몇 쪽~몇 쪽)를 한 줄로 알려 주시겠어요? (GPT 연결 시 더 맞춤 제안을 드릴 수 있어요.)`;
      return res.json({ ok: true, reply: replyText, usedOpenAi: false, model: null });
    }

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.45,
      max_tokens: 700,
      messages: [
        { role: "system", content: systemBlock },
        ...hist.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message }
      ]
    });
    const replyText = String(response.choices?.[0]?.message?.content || "").trim();
    if (!replyText) {
      return res.status(502).json({
        error: "GPT 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요."
      });
    }
    res.json({
      ok: true,
      reply: replyText,
      usedOpenAi: true,
      model: OPENAI_MODEL
    });
  } catch (e) {
    console.error("/api/student/coach/tomorrow-plan/message error", e);
    res.status(500).json({ error: "내일 계획 대화 응답에 실패했습니다." });
  }
});

/** 대화를 바탕으로 책별 내일 계획 JSON 생성 */
app.post("/api/student/coach/tomorrow-plan/synthesize", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const body = req.body || {};
    const context = body.context;
    const history = Array.isArray(body.history) ? body.history : [];
    if (!context || typeof context !== "object") {
      return res.status(400).json({ error: "context가 필요합니다." });
    }
    const focus = context.collabFocus === "life" ? "life" : "study";
    const books = Array.isArray(context.books) ? context.books : [];
    const allowedIds = new Set(books.map(b => Number(b.id)).filter(Number.isFinite));

    const hist = history.slice(-28).map(h => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: String(h.content || "").slice(0, 6000)
    }));

    const bookIdsJson = JSON.stringify(books.map(b => b.id));

    if (focus === "life") {
      if (!openai) {
        const fallback =
          "내일 아침에 10분만이라도 실천할 한 가지를 기록 탭에 적어 주세요.";
        return res.json({
          ok: true,
          tomorrowPractice: fallback.slice(0, 500),
          usedOpenAi: false,
          model: null
        });
      }
      const systemLife = `너는 한국 학생의 '내일 실천할 한 가지' 문장을 기록 탭에 넣을 수 있게 정리한다.
대화와 상황 JSON을 반영해, 실행 가능한 한 가지 실천을 한 문장 또는 짧은 두 문장(500자 이내)으로만 출력한다.

출력: JSON 객체 하나만. 설명·마크다운·코드펜스 금지.
스키마: {"tomorrowPractice":"..."}`;

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.35,
        max_tokens: 400,
        messages: [
          { role: "system", content: systemLife },
          { role: "system", content: `[상황 JSON]\n${JSON.stringify(context)}` },
          ...hist.map(m => ({ role: m.role, content: m.content })),
          {
            role: "user",
            content:
              "위 대화를 반영해 내일 실천할 한 가지 문장만 JSON 객체로 출력하라."
          }
        ]
      });
      const raw = String(response.choices?.[0]?.message?.content || "").trim();
      const obj = extractJsonObjectFromModelText(raw);
      const tp = String(obj?.tomorrowPractice ?? "").trim().slice(0, 500);
      if (!tp) {
        return res.status(502).json({
          error:
            "내일 실천 문장을 해석하지 못했습니다. 대화를 조금 더 한 뒤 다시 시도해 주세요."
        });
      }
      return res.json({
        ok: true,
        tomorrowPractice: tp,
        usedOpenAi: true,
        model: OPENAI_MODEL
      });
    }

    if (!openai) {
      const pct = Number(context.todayProgressPercent) || 0;
      const plans = books.map(b => ({
        bookId: Number(b.id),
        plannedRange: `${String(b.name || "")}: 오늘 이행률 ${pct}%. 대화를 바탕으로 범위를 직접 다듬어 주세요.`,
        startTime: null,
        endTime: null
      }));
      return res.json({ ok: true, plans, usedOpenAi: false, model: null });
    }

    const systemSynth = `너는 한국 학생의 내일 학습 계획을 책(교재)별로 정리한다.
대화와 상황 JSON을 반영해 각 책에 대해 내일 공부 범위(plannedRange)와 가능하면 시작·종료 시각을 제안한다.

출력: JSON 배열만. 설명·마크다운·코드펜스 금지.
스키마: [{"bookId":number,"plannedRange":string,"startTime":string|null,"endTime":string|null}]
bookId는 반드시 다음 중 하나만: ${bookIdsJson}
시각은 "HH:MM" 24시간 형식이거나 null.`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.25,
      max_tokens: 1200,
      messages: [
        { role: "system", content: systemSynth },
        { role: "system", content: `[상황 JSON]\n${JSON.stringify(context)}` },
        ...hist.map(m => ({ role: m.role, content: m.content })),
        {
          role: "user",
          content:
            "위 대화 전체를 반영해, 각 등록 교재에 대한 내일 계획만 JSON 배열로 출력하라."
        }
      ]
    });
    const raw = String(response.choices?.[0]?.message?.content || "").trim();
    const arr = extractJsonArrayFromModelText(raw);
    if (!arr || arr.length === 0) {
      return res.status(502).json({
        error: "계획 JSON을 해석하지 못했습니다. 대화를 조금 더 한 뒤 다시 시도해 주세요."
      });
    }
    const normHHMM = v => {
      const s = v != null ? String(v).trim() : "";
      if (!s) return null;
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
      const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
      return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    };
    const plans = [];
    for (const row of arr) {
      const bookId = Number(row.bookId);
      if (!Number.isFinite(bookId) || !allowedIds.has(bookId)) continue;
      const plannedRange = String(row.plannedRange || "").trim().slice(0, 500);
      plans.push({
        bookId,
        plannedRange: plannedRange || "범위를 기록 탭에서 입력해 주세요.",
        startTime: normHHMM(row.startTime),
        endTime: normHHMM(row.endTime)
      });
    }
    if (plans.length === 0) {
      return res.status(502).json({
        error: "유효한 책별 계획이 없습니다. 대화를 조금 더 한 뒤 다시 시도해 주세요."
      });
    }
    res.json({ ok: true, plans, usedOpenAi: true, model: OPENAI_MODEL });
  } catch (e) {
    console.error("/api/student/coach/tomorrow-plan/synthesize error", e);
    res.status(500).json({ error: "내일 계획 반영용 데이터 생성에 실패했습니다." });
  }
});

// 학생: 학습 앱 설치 상태 저장
app.put("/api/student/store-apps/:appId", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const appId = String(req.params.appId || "").trim();
    const installed = Boolean((req.body || {}).installed);
    const serialFromBody = String((req.body || {}).serial || "").trim();
    if (!appId) {
      return res.status(400).json({ error: "appId가 필요합니다." });
    }
    if (isLikelySerial(serialFromBody)) {
      await linkDeviceToUserBySerial(req.userId, serialFromBody).catch(err => {
        console.warn("device link skipped on store install body:", err.message);
      });
    }
    await attachDeviceByCookieIfPresent(req, req.userId).catch(err => {
      console.warn("device link skipped on store install:", err.message);
    });
    const appRow = await getStoreAppByKey(appId);
    if (!appRow) {
      return res.status(404).json({ error: "앱을 찾을 수 없습니다." });
    }
    if (!isSimpleMdmConfigured()) {
      return res.status(503).json({
        error:
          "서버에 SIMPLEMDM_API_KEY가 설정되어 있지 않아 학습 앱 설치를 처리할 수 없습니다. 운영 서버 환경변수를 확인하세요."
      });
    }
    const linkedSerial = await getActiveDeviceSerialForUser(req.userId);
    const serial = linkedSerial || (isLikelySerial(serialFromBody) ? serialFromBody : "");
    if (!serial) {
      return res.status(400).json({
        error: "이 학생 계정에 연결된 기기가 없습니다."
      });
    }
    const device = await findDeviceBySerial(serial);
    if (!device?.id) {
      return res.status(404).json({
        error: "SimpleMDM에서 해당 기기를 찾지 못했습니다."
      });
    }
    const deviceId = Number(device.id);
    let simpleMdmAppId = Number(appRow.simplemdm_app_id || 0);
    if (!simpleMdmAppId) {
      let matchedApp = await findAppByBundleIdOrName(
        appRow.bundle_id,
        appRow.name
      );
      if (!matchedApp) {
        matchedApp = await createAppInCatalog({
          appStoreId: appRow.app_store_id,
          bundleId: appRow.bundle_id,
          name: appRow.name
        });
      }
      if (!matchedApp?.id) {
        return res.status(404).json({
          error:
            "SimpleMDM 앱 카탈로그에서 앱을 찾거나 생성하지 못했습니다."
        });
      }
      simpleMdmAppId = Number(matchedApp.id);
      await updateStoreAppSimpleMdmId(appRow.app_key, simpleMdmAppId);
    }
    let group = await getStudentMdmGroup(req.userId);
    if (!group) {
      const created = await createAssignmentGroup(`student-${req.userId}`);
      if (!created?.id) {
        throw new Error("학생용 assignment group 생성에 실패했습니다.");
      }
      group = await upsertStudentMdmGroup(
        req.userId,
        Number(created.id),
        created.attributes?.name || `student-${req.userId}`
      );
    }
    await assignDeviceToGroup(group.assignment_group_id, deviceId);
    let syncWarning = null;
    if (installed) {
      await assignAppToGroup(group.assignment_group_id, simpleMdmAppId);
      await pushApps(group.assignment_group_id);
      await pushAssignedAppsToDevice(deviceId).catch(err => {
        syncWarning = err.message || "device push failed";
      });
    } else {
      await unassignAppFromGroup(group.assignment_group_id, simpleMdmAppId);
      const installedApp = await findInstalledAppForDevice(
        simpleMdmAppId,
        deviceId
      );
      if (!installedApp?.id) {
        throw new Error("기기에서 삭제할 앱 설치 기록을 찾지 못했습니다.");
      }
      await uninstallInstalledApp(Number(installedApp.id));
    }
    await refreshDevice(deviceId).catch(err => {
      if (!syncWarning) {
        syncWarning = err.message || "device refresh failed";
      }
    });
    const saved = await setStoreAppInstalled(req.userId, appId, installed);
    res.json({
      ok: true,
      sync: {
        deviceId,
        refreshRequested: true,
        warning: syncWarning
      },
      app: {
        id: saved.app_key,
        name: saved.name,
        category: saved.category,
        description: saved.description,
        url: saved.url,
        installed: Boolean(saved.is_installed),
        installedAt: saved.installed_at,
        removedAt: saved.removed_at,
        updatedAt: saved.updated_at
      }
    });
  } catch (e) {
    console.error("/api/student/store-apps PUT error", e);
    res.status(500).json({
      error: e?.message || "앱 상태 저장에 실패했습니다."
    });
  }
});

// 현재 로그인한 학생 계정에 웹클립 기기 세션이 있으면 즉시 연결
app.post("/api/device/link-current", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    await attachDeviceByCookieIfPresent(req, req.userId);
    const serial = await getActiveDeviceSerialForUser(req.userId);
    res.json({
      ok: true,
      linked: Boolean(serial),
      serial: serial || null
    });
  } catch (e) {
    console.error("/api/device/link-current error", e);
    res.status(500).json({ error: "기기 연결 확인에 실패했습니다." });
  }
});

// 현재 로그인한 학생 계정에 전달받은 serial로 즉시 기기 연결
app.post("/api/device/link-serial", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me) {
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    }
    const serial = String((req.body || {}).serial || "").trim();
    if (!isLikelySerial(serial)) {
      return res.status(400).json({ error: "serial 값이 올바르지 않습니다." });
    }
    await linkDeviceToUserBySerial(req.userId, serial);
    const activeSerial = await getActiveDeviceSerialForUser(req.userId);
    res.json({
      ok: true,
      linked: Boolean(activeSerial),
      serial: activeSerial || null
    });
  } catch (e) {
    console.error("/api/device/link-serial error", e);
    res.status(500).json({ error: "기기 연결에 실패했습니다." });
  }
});

async function connectDbWithRetry() {
  try {
    await applySchemaIfNeeded();
    dbConnected = true;
    if (!cronStarted) {
      startDailyAiReportCron();
      startPlannerLockCron();
      await reconcileAllPlannerLocks().catch(err => {
        console.error("planner lock reconciliation on startup failed:", err);
      });
      cronStarted = true;
    }
    console.log("DB 연결 성공");
  } catch (e) {
    dbConnected = false;
    console.error("DB 연결 실패:", e.message);
    console.error("30초 후 DB 재시도합니다. DATABASE_URL 값을 확인해 주세요.");
    setTimeout(connectDbWithRetry, 30000);
  }
}

async function start() {
  assertRuntimeConfig();
  app.listen(PORT, () => {
    console.log(`Daechi Planner API listening on http://localhost:${PORT}`);
    connectDbWithRetry();
  });
}

start();

