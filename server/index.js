const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const {
  findUserByEmail,
  createUser,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData,
  getMe,
  listParentStudents,
  parentRequestLink,
  studentRequestParent,
  listParentLinkRequests,
  listStudentLinkRequests,
  studentConfirmLinkRequest,
  parentConfirmLinkRequest,
  rejectLinkRequest,
  parentHasStudent,
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
  upsertStudentMdmGroup
} = require("./db");
const {
  computeWeeklyStats,
  buildWeeklySummaryLines
} = require("./analytics");
const { startDailyAiReportCron } = require("./dailyReportCron");
const { runOnePair } = require("./aiReportService");
const {
  findDeviceBySerial,
  findAppByName,
  createAssignmentGroup,
  assignAppToGroup,
  unassignAppFromGroup,
  assignDeviceToGroup,
  pushApps
} = require("./simpleMdmClient");

const JWT_SECRET = process.env.JWT_SECRET || "daechi-dev-secret";
const PORT = process.env.PORT || 3000;
const WEB_APP_URL =
  (process.env.WEB_APP_URL || "http://localhost:5173").replace(/\/+$/, "");
const WEBCLIP_COOKIE_NAME = "daechi_device_session";
let dbConnected = false;
let cronStarted = false;
let schemaApplied = false;

const app = express();

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
    req.userId = decoded.userId;
    next();
  } catch (e) {
    return res
      .status(401)
      .json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
  }
}

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, role, serial } = req.body || {};
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
  const nextUrl = resolveWebRedirect(req.query.next);
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
    await replaceStudyBlocks(req.userId, date, blocks);
    res.json({ ok: true });
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
    await upsertStudyPlans(req.userId, date, plans);
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/plan error", e);
    res.status(500).json({ error: "계획 저장에 실패했습니다." });
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
    res.json({
      rule: {
        enabled: Boolean(rule.enabled),
        lockTime: String(rule.lock_time || "21:00").slice(0, 5),
        updatedAt: rule.updated_at
      }
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
    res.json({
      ok: true,
      rule: {
        enabled: Boolean(saved.enabled),
        lockTime: String(saved.lock_time).slice(0, 5),
        updatedAt: saved.updated_at
      }
    });
  } catch (e) {
    console.error("/api/parent/planner-rule PUT error", e);
    res.status(500).json({ error: "설정 저장에 실패했습니다." });
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

// 학생: 학습 앱 설치 상태 저장
app.put("/api/student/store-apps/:appId", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "student") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const appId = String(req.params.appId || "").trim();
    const installed = Boolean((req.body || {}).installed);
    if (!appId) {
      return res.status(400).json({ error: "appId가 필요합니다." });
    }
    await attachDeviceByCookieIfPresent(req, req.userId).catch(err => {
      console.warn("device link skipped on store install:", err.message);
    });
    const appRow = await getStoreAppByKey(appId);
    if (!appRow) {
      return res.status(404).json({ error: "앱을 찾을 수 없습니다." });
    }
    const serial = await getActiveDeviceSerialForUser(req.userId);
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
      const matchedApp = await findAppByName(appRow.name);
      if (!matchedApp?.id) {
        return res.status(404).json({
          error: "SimpleMDM 앱 카탈로그에서 같은 이름의 앱을 찾지 못했습니다."
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
    res.status(500).json({ error: "앱 상태 저장에 실패했습니다." });
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
  app.listen(PORT, () => {
    console.log(`Daechi Planner API listening on http://localhost:${PORT}`);
    connectDbWithRetry();
  });
}

start();

