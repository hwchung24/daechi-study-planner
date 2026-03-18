const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

async function findUserByEmail(email) {
  const trimmed = String(email).trim().toLowerCase();
  const res = await query("SELECT * FROM users WHERE email = $1", [trimmed]);
  return res.rows[0] || null;
}

async function createUser(email, passwordHash, role = "student") {
  const trimmed = String(email).trim().toLowerCase();
  const res = await query(
    "INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id",
    [trimmed, role]
  );
  const id = res.rows[0].id;
  if (role === "student") {
    // 스키마에 student_id FK가 존재해서 간단히 자기 자신을 참조하도록 처리 (MVP)
    await query("UPDATE users SET student_id = id WHERE id = $1", [id]);
  }
  if (role === "parent") {
    await query("INSERT INTO parents (user_id) VALUES ($1)", [id]);
  }
  return id;
}

async function getMe(userId) {
  const res = await query(
    "SELECT id, email, role FROM users WHERE id = $1",
    [userId]
  );
  return res.rows[0] || null;
}

async function getParentIdByUserId(parentUserId) {
  const res = await query("SELECT id FROM parents WHERE user_id = $1", [
    parentUserId
  ]);
  return res.rows[0] || null;
}

async function listParentStudents(parentUserId) {
  const parent = await getParentIdByUserId(parentUserId);
  if (!parent) return [];
  const res = await query(
    `SELECT u.id, u.email
     FROM parents_students ps
     JOIN users u ON u.id = ps.student_id
     WHERE ps.parent_id = $1
     ORDER BY u.email ASC`,
    [parent.id]
  );
  return res.rows;
}

async function linkParentStudent(parentUserId, studentEmail) {
  const student = await findUserByEmail(studentEmail);
  if (!student || student.role !== "student") {
    return { ok: false, error: "해당 이메일의 학생 계정을 찾을 수 없습니다." };
  }
  const parent = await getParentIdByUserId(parentUserId);
  if (!parent) {
    return { ok: false, error: "학부모 계정 정보가 없습니다." };
  }

  await query(
    `INSERT INTO parents_students (parent_id, student_id)
     VALUES ($1, $2)
     ON CONFLICT (parent_id, student_id) DO NOTHING`,
    [parent.id, student.id]
  );
  return { ok: true };
}

async function parentHasStudent(parentUserId, studentId) {
  const parent = await getParentIdByUserId(parentUserId);
  if (!parent) return false;
  const res = await query(
    `SELECT 1
     FROM parents_students
     WHERE parent_id = $1 AND student_id = $2
     LIMIT 1`,
    [parent.id, studentId]
  );
  return res.rows.length > 0;
}

async function getOrCreateStudyDay(userId, date) {
  let res = await query(
    "SELECT * FROM study_days WHERE user_id = $1 AND date = $2",
    [userId, date]
  );
  if (res.rows[0]) return res.rows[0];
  res = await query(
    "INSERT INTO study_days (user_id, date) VALUES ($1, $2) RETURNING *",
    [userId, date]
  );
  return res.rows[0];
}

async function replaceStudyBlocks(userId, date, blocks) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await getOrCreateStudyDay(userId, date);
    await client.query("DELETE FROM study_blocks WHERE study_day_id = $1", [
      day.id
    ]);
    const insertText =
      "INSERT INTO study_blocks (study_day_id, subject, start_time, end_time, done, focus_score) VALUES ($1, $2, $3, $4, $5, $6)";
    for (const b of blocks) {
      await client.query(insertText, [
        day.id,
        b.subject,
        b.startTime,
        b.endTime,
        !!b.done,
        b.focusScore || null
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function upsertStudyPlans(userId, date, plans) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await getOrCreateStudyDay(userId, date);

    for (const p of plans) {
      const bookRes = await client.query(
        `INSERT INTO study_books (user_id, name)
         VALUES ($1, $2)
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userId, p.bookName]
      );
      const bookId = bookRes.rows[0].id;

      await client.query(
        `INSERT INTO study_plans (study_day_id, book_id, planned_range, start_time, end_time, mid_pct, final_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (study_day_id, book_id)
         DO UPDATE SET planned_range = EXCLUDED.planned_range,
                       start_time    = EXCLUDED.start_time,
                       end_time      = EXCLUDED.end_time,
                       mid_pct       = EXCLUDED.mid_pct,
                       final_pct     = EXCLUDED.final_pct,
                       updated_at    = now()`,
        [
          day.id,
          bookId,
          p.plannedRange || null,
          p.startTime || null,
          p.endTime || null,
          p.midPct ?? null,
          p.finalPct ?? null
        ]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getWeekData(userId, weekStart, weekEnd) {
  const daysRes = await query(
    "SELECT * FROM study_days WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date ASC",
    [userId, weekStart, weekEnd]
  );
  const days = daysRes.rows;
  if (days.length === 0) {
    return { days: [], blocks: [], plans: [] };
  }
  const ids = days.map(d => d.id);
  const params = ids.map((_, i) => `$${i + 1}`).join(",");
  const blocksRes = await query(
    `SELECT * FROM study_blocks WHERE study_day_id IN (${params})`,
    ids
  );
  const plansRes = await query(
    `SELECT * FROM study_plans WHERE study_day_id IN (${params})`,
    ids
  );
  return { days, blocks: blocksRes.rows, plans: plansRes.rows };
}

module.exports = {
  pool,
  query,
  findUserByEmail,
  createUser,
  getMe,
  listParentStudents,
  linkParentStudent,
  parentHasStudent,
  getOrCreateStudyDay,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData
};


