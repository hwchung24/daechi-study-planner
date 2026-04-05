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
  countUnreadStudentNotifications,
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
  findDeviceBySerial,
  findAppByBundleIdOrName,
  findInstalledAppForDevice,
  createAppInCatalog,
  createAssignmentGroup,
  assignAppToGroup,
  unassignAppFromGroup,
  uninstallInstalledApp,
  assignDeviceToGroup,
  pushApps
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
    "너는 한국 중·고등학생 학습 코치다. 입력 JSON의 weekRhythm 배열만 근거로 2~6개의 패턴을 진단한다. null은 해당 날 미기록. 의학·정신질환 진단, 자해 조장, 시험 부정행위는 금지. 반드시 아래 형태의 JSON만 출력하고 다른 글자는 쓰지 마라: {\"patterns\":[{\"title\":\"짧은 제목\",\"severity\":\"낮음\"|\"보통\"|\"높음\",\"explanation\":\"2~4문장\",\"recommendation\":\"실행 팁 1~2문장\"}]}. 기록이 거의 없으면 patterns는 1개로 짧게 안내한다.";
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
  const allowlist = new Set([WEB_APP_URL, ...extra]);
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

    if (hasNameKey && user.role === "student") {
      const nameIn = String(body.name ?? "").trim();
      if (nameIn.length > 40) {
        return res.status(400).json({ error: "이름은 40자 이내로 입력해 주세요." });
      }
      if (nameIn.length > 0) {
        await upsertStudentCoachProfile(req.userId, { name: nameIn });
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
        d.stressScore != null
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
      fieldHelp: {
        sleepHours: "시간, 미기록은 null",
        stressScore: "1~5 (높을수록 스트레스 큼)",
        concentrationScore: "1~5",
        concentrationPercent: "대략 0~100 환산",
        studyMinutes: "분",
        planCompletionRate: "0~100",
        steps: "걸음 수",
        mealsRegularity: "1~5"
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
    if (patterns.length === 0) {
      patterns = [
        {
          key: "ai_pat_0",
          title: recordedDays < 2 ? "기록이 더 필요해요" : "패턴 요약",
          severity: "낮음",
          explanation:
            recordedDays < 2
              ? "이번 주에 입력된 날이 적어요. 오늘 공부 탭에서 하루 기록을 쌓으면 그래프·AI 분석이 정확해져요."
              : "응답은 왔지만 항목이 비어 있었어요. 새로고침 후 다시 시도해 보세요.",
          recommendation:
            "수면·스트레스·집중·공부 시간·목표 달성률을 같은 날에 저장해 두면 한 주 흐름을 보기 좋아요."
        }
      ];
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
    const chatMode = rawMode === "suneung" ? "suneung" : "learning";

    await insertStudentCoachMessage(req.userId, "user", text);

    const profile = await getStudentCoachProfile(req.userId);
    const logs = await listRecentStudentCoachLogs(req.userId, 14);
    const history = await listRecentStudentCoachMessages(req.userId, 12);
    const snapshot = buildCoachSnapshot(profile, logs);

    const systemLearning =
      "너는 한국 학생 전용 학습 코치다. 항상 한국어로 답하고, 짧고 실행 가능한 조언을 준다. 의학적 진단·자해 조장·시험 부정행위는 거절한다. 형식: 1)원인 분석 2)오늘의 우선순위 3)실행 팁 4)격려 한 줄";
    const systemSuneung =
      "너는 수능(대학수학능력시험) 범위에서 학생과 질의응답하는 과목 코치다. 국어·수학·영어·탐구 등 과목별로 (1) 처음 배우는 개념 (2) 비슷해서 헷갈리는 개념 (3) 풀이가 막히거나 모르는 문제·유형에 대해 학생이 질문하면, 정의·차이·풀이 접근을 짧고 명확히 설명한다. 필요하면 예시·비유·풀이 단계(힌트)를 덧붙인다. 항상 한국어 존댓말. 정당한 학습 범위 안에서만 답한다. 특정 시험의 정답·문제지 유출·답안 그대로 알려 달라는 요청·시험 부정행위 조력은 거절한다. 의학적 진단·자해 조장은 거절한다. 답 형식은 질문에 맞게 가되, 보통 ①핵심 설명 ②헷갈릴 때 구분 포인트 또는 풀이 단계 ③스스로 확인할 질문 한 가지 순으로 짧게 맞춘다.";

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
            content: `학생 프로필/요약: ${JSON.stringify(snapshot)}`
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
        replyText = [
          "1) 원인 분석",
          `- ${snapshot.heroNarrative}`,
          "",
          "2) 오늘의 우선순위",
          `- ${snapshot.nextActions[0]}`,
          "",
          "3) 실행 팁",
          "- 첫 25분만 시작하면 집중 흐름이 살아납니다.",
          "",
          "4) 격려 한 줄",
          "- 오늘은 완벽보다 시작입니다. 지금 1개만 해도 충분해요."
        ].join("\n");
      }
    }

    await insertStudentCoachMessage(req.userId, "assistant", replyText);
    res.json({
      ok: true,
      reply: replyText,
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
    await assignDeviceToGroup(group.assignment_group_id, Number(device.id));
    if (installed) {
      await assignAppToGroup(group.assignment_group_id, simpleMdmAppId);
      await pushApps(group.assignment_group_id);
    } else {
      await unassignAppFromGroup(group.assignment_group_id, simpleMdmAppId);
      const installedApp = await findInstalledAppForDevice(
        simpleMdmAppId,
        Number(device.id)
      );
      if (!installedApp?.id) {
        throw new Error("기기에서 삭제할 앱 설치 기록을 찾지 못했습니다.");
      }
      await uninstallInstalledApp(Number(installedApp.id));
    }
    const saved = await setStoreAppInstalled(req.userId, appId, installed);
    res.json({
      ok: true,
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

