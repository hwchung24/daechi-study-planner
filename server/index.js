const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const {
  findUserByEmail,
  createUser,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData,
  getMe,
  listParentStudents,
  linkParentStudent,
  parentHasStudent,
  ensureConnected
} = require("./db");
const {
  computeWeeklyStats,
  buildWeeklySummaryLines
} = require("./analytics");

const JWT_SECRET = process.env.JWT_SECRET || "daechi-dev-secret";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

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
    const { email, password, role } = req.body || {};
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
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, userId, email: trimmedEmail });
  } catch (e) {
    console.error("/auth/register error", e);
    res.status(500).json({ error: "회원가입에 실패했습니다." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
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
    res.json({ token, userId: user.id, email: user.email });
  } catch (e) {
    console.error("/auth/login error", e);
    res.status(500).json({ error: "로그인에 실패했습니다." });
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

// 학부모가 학생 계정을 연결
app.post("/api/parent/link-student", authMiddleware, async (req, res) => {
  try {
    const me = await getMe(req.userId);
    if (!me || me.role !== "parent") {
      return res.status(403).json({ error: "권한이 없습니다." });
    }
    const { studentEmail } = req.body || {};
    if (!studentEmail) {
      return res.status(400).json({ error: "studentEmail이 필요합니다." });
    }
    const result = await linkParentStudent(req.userId, studentEmail);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "연결에 실패했습니다." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/parent/link-student error", e);
    res.status(500).json({ error: "연결에 실패했습니다." });
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

async function start() {
  try {
    await ensureConnected();
  } catch (e) {
    console.error("DB 연결 실패:", e.message);
    console.error("server/.env 의 DATABASE_URL 값을 확인해 주세요.");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Daechi Planner API listening on http://localhost:${PORT}`);
  });
}

start();

