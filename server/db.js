const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

async function ensureConnected() {
  await query("SELECT 1", []);
}

async function findUserByEmail(email) {
  const trimmed = String(email).trim().toLowerCase();
  const res = await query("SELECT * FROM users WHERE email = $1", [trimmed]);
  return res.rows[0] || null;
}

async function createUser(email, passwordHash, role = "student") {
  const trimmed = String(email).trim().toLowerCase();
  const res = await query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
    [trimmed, passwordHash, role]
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

async function insertParentsStudentsRow(parentDbId, studentUserId) {
  await query(
    `INSERT INTO parents_students (parent_id, student_id)
     VALUES ($1, $2)
     ON CONFLICT (parent_id, student_id) DO NOTHING`,
    [parentDbId, studentUserId]
  );
}

/** 학부모가 학생 이메일로 연결 요청 (학생 승인 필요) */
async function parentRequestLink(parentUserId, studentEmail) {
  const student = await findUserByEmail(studentEmail);
  if (!student || student.role !== "student") {
    return { ok: false, error: "해당 이메일의 학생 계정을 찾을 수 없습니다." };
  }
  const parent = await getParentIdByUserId(parentUserId);
  if (!parent) {
    return { ok: false, error: "학부모 계정 정보가 없습니다." };
  }
  if (student.id === parentUserId) {
    return { ok: false, error: "자기 자신과 연결할 수 없습니다." };
  }
  const already = await query(
    `SELECT 1 FROM parents_students ps
     WHERE ps.parent_id = $1 AND ps.student_id = $2`,
    [parent.id, student.id]
  );
  if (already.rows.length) {
    return { ok: false, error: "이미 연결된 학생입니다." };
  }
  const pend = await query(
    `SELECT id FROM parent_student_link_requests
     WHERE parent_user_id = $1 AND student_user_id = $2 AND status = 'pending'`,
    [parentUserId, student.id]
  );
  if (pend.rows.length) {
    return { ok: false, error: "이미 진행 중인 연결 요청이 있습니다." };
  }
  const ins = await query(
    `INSERT INTO parent_student_link_requests
     (parent_user_id, student_user_id, initiated_by, parent_confirmed_at, student_confirmed_at, status)
     VALUES ($1, $2, 'parent', now(), NULL, 'pending')
     RETURNING id`,
    [parentUserId, student.id]
  );
  return { ok: true, requestId: ins.rows[0].id };
}

/** 학생이 학부모 이메일로 연결 요청 (학부모 승인 필요) */
async function studentRequestParent(studentUserId, parentEmail) {
  const parentUser = await findUserByEmail(parentEmail);
  if (!parentUser || parentUser.role !== "parent") {
    return { ok: false, error: "해당 이메일의 학부모 계정을 찾을 수 없습니다." };
  }
  const parent = await getParentIdByUserId(parentUser.id);
  if (!parent) {
    return { ok: false, error: "학부모 계정 정보가 없습니다." };
  }
  if (studentUserId === parentUser.id) {
    return { ok: false, error: "자기 자신과 연결할 수 없습니다." };
  }
  const already = await query(
    `SELECT 1 FROM parents_students ps
     WHERE ps.parent_id = $1 AND ps.student_id = $2`,
    [parent.id, studentUserId]
  );
  if (already.rows.length) {
    return { ok: false, error: "이미 연결된 학부모입니다." };
  }
  const pend = await query(
    `SELECT id FROM parent_student_link_requests
     WHERE parent_user_id = $1 AND student_user_id = $2 AND status = 'pending'`,
    [parentUser.id, studentUserId]
  );
  if (pend.rows.length) {
    return { ok: false, error: "이미 진행 중인 연결 요청이 있습니다." };
  }
  const ins = await query(
    `INSERT INTO parent_student_link_requests
     (parent_user_id, student_user_id, initiated_by, parent_confirmed_at, student_confirmed_at, status)
     VALUES ($1, $2, 'student', NULL, now(), 'pending')
     RETURNING id`,
    [parentUser.id, studentUserId]
  );
  return { ok: true, requestId: ins.rows[0].id };
}

async function listParentLinkRequests(parentUserId) {
  const waitingOnStudent = await query(
    `SELECT r.id, r.created_at, u.email AS student_email, u.id AS student_id
     FROM parent_student_link_requests r
     JOIN users u ON u.id = r.student_user_id
     WHERE r.parent_user_id = $1 AND r.status = 'pending'
       AND r.initiated_by = 'parent'
       AND r.parent_confirmed_at IS NOT NULL
       AND r.student_confirmed_at IS NULL
     ORDER BY r.created_at DESC`,
    [parentUserId]
  );
  const waitingOnMe = await query(
    `SELECT r.id, r.created_at, u.email AS student_email, u.id AS student_id
     FROM parent_student_link_requests r
     JOIN users u ON u.id = r.student_user_id
     WHERE r.parent_user_id = $1 AND r.status = 'pending'
       AND r.initiated_by = 'student'
       AND r.student_confirmed_at IS NOT NULL
       AND r.parent_confirmed_at IS NULL
     ORDER BY r.created_at DESC`,
    [parentUserId]
  );
  return {
    waitingOnStudent: waitingOnStudent.rows,
    waitingOnMe: waitingOnMe.rows
  };
}

async function listStudentLinkRequests(studentUserId) {
  const waitingOnParent = await query(
    `SELECT r.id, r.created_at, u.email AS parent_email, u.id AS parent_user_id
     FROM parent_student_link_requests r
     JOIN users u ON u.id = r.parent_user_id
     WHERE r.student_user_id = $1 AND r.status = 'pending'
       AND r.initiated_by = 'student'
       AND r.student_confirmed_at IS NOT NULL
       AND r.parent_confirmed_at IS NULL
     ORDER BY r.created_at DESC`,
    [studentUserId]
  );
  const waitingOnMe = await query(
    `SELECT r.id, r.created_at, u.email AS parent_email, u.id AS parent_user_id
     FROM parent_student_link_requests r
     JOIN users u ON u.id = r.parent_user_id
     WHERE r.student_user_id = $1 AND r.status = 'pending'
       AND r.initiated_by = 'parent'
       AND r.parent_confirmed_at IS NOT NULL
       AND r.student_confirmed_at IS NULL
     ORDER BY r.created_at DESC`,
    [studentUserId]
  );
  return {
    waitingOnParent: waitingOnParent.rows,
    waitingOnMe: waitingOnMe.rows
  };
}

async function studentConfirmLinkRequest(studentUserId, requestId) {
  const req = await query(
    `SELECT * FROM parent_student_link_requests WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  const row = req.rows[0];
  if (!row) return { ok: false, error: "요청을 찾을 수 없습니다." };
  if (row.student_user_id !== studentUserId) {
    return { ok: false, error: "권한이 없습니다." };
  }
  if (row.initiated_by !== "parent" || !row.parent_confirmed_at || row.student_confirmed_at) {
    return { ok: false, error: "승인할 수 없는 요청입니다." };
  }
  const parent = await getParentIdByUserId(row.parent_user_id);
  if (!parent) return { ok: false, error: "학부모 정보를 찾을 수 없습니다." };
  await query(
    `UPDATE parent_student_link_requests
     SET student_confirmed_at = now(), status = 'active', updated_at = now()
     WHERE id = $1`,
    [requestId]
  );
  await insertParentsStudentsRow(parent.id, row.student_user_id);
  return { ok: true };
}

async function parentConfirmLinkRequest(parentUserId, requestId) {
  const req = await query(
    `SELECT * FROM parent_student_link_requests WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  const row = req.rows[0];
  if (!row) return { ok: false, error: "요청을 찾을 수 없습니다." };
  if (row.parent_user_id !== parentUserId) {
    return { ok: false, error: "권한이 없습니다." };
  }
  if (row.initiated_by !== "student" || !row.student_confirmed_at || row.parent_confirmed_at) {
    return { ok: false, error: "승인할 수 없는 요청입니다." };
  }
  const parent = await getParentIdByUserId(parentUserId);
  if (!parent) return { ok: false, error: "학부모 정보를 찾을 수 없습니다." };
  await query(
    `UPDATE parent_student_link_requests
     SET parent_confirmed_at = now(), status = 'active', updated_at = now()
     WHERE id = $1`,
    [requestId]
  );
  await insertParentsStudentsRow(parent.id, row.student_user_id);
  return { ok: true };
}

async function rejectLinkRequest(userId, requestId) {
  const req = await query(
    `SELECT * FROM parent_student_link_requests WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  const row = req.rows[0];
  if (!row) return { ok: false, error: "요청을 찾을 수 없습니다." };
  if (row.parent_user_id !== userId && row.student_user_id !== userId) {
    return { ok: false, error: "권한이 없습니다." };
  }
  await query(
    `UPDATE parent_student_link_requests
     SET status = 'rejected', updated_at = now()
     WHERE id = $1`,
    [requestId]
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

async function getOrCreateStudyDayWithClient(client, userId, date) {
  let res = await client.query(
    "SELECT * FROM study_days WHERE user_id = $1 AND date = $2",
    [userId, date]
  );
  if (res.rows[0]) return res.rows[0];
  res = await client.query(
    "INSERT INTO study_days (user_id, date) VALUES ($1, $2) RETURNING *",
    [userId, date]
  );
  return res.rows[0];
}

async function getOrCreateStudyDay(userId, date) {
  const client = await pool.connect();
  try {
    return await getOrCreateStudyDayWithClient(client, userId, date);
  } finally {
    client.release();
  }
}

async function replaceStudyBlocks(userId, date, blocks) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await getOrCreateStudyDayWithClient(client, userId, date);
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
    const day = await getOrCreateStudyDayWithClient(client, userId, date);

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

/** 크론용: 연결된 부모 user_id + 학생 user_id 쌍 */
async function listAllParentStudentPairs() {
  const res = await query(
    `SELECT p.user_id AS parent_user_id, ps.student_id AS student_user_id
     FROM parents_students ps
     JOIN parents p ON p.id = ps.parent_id`
  );
  return res.rows;
}

async function upsertParentAiReport(
  parentUserId,
  studentUserId,
  reportDate,
  summaryText,
  model
) {
  await query(
    `INSERT INTO parent_ai_reports (parent_user_id, student_user_id, report_date, summary_text, model)
     VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (parent_user_id, student_user_id, report_date)
     DO UPDATE SET summary_text = EXCLUDED.summary_text,
                   model = EXCLUDED.model,
                   created_at = now()`,
    [parentUserId, studentUserId, reportDate, summaryText, model]
  );
}

async function getLatestParentAiReport(parentUserId, studentUserId) {
  const res = await query(
    `SELECT id, parent_user_id, student_user_id, report_date, summary_text, model, created_at
     FROM parent_ai_reports
     WHERE parent_user_id = $1 AND student_user_id = $2
     ORDER BY report_date DESC, created_at DESC
     LIMIT 1`,
    [parentUserId, studentUserId]
  );
  return res.rows[0] || null;
}

async function createWebclipSession(tokenHash, serial, expiresAtIso) {
  await query(
    `INSERT INTO webclip_device_sessions (token_hash, serial_number, expires_at)
     VALUES ($1, $2, $3::timestamptz)`,
    [tokenHash, serial, expiresAtIso]
  );
}

async function consumeWebclipSession(tokenHash) {
  const res = await query(
    `UPDATE webclip_device_sessions
     SET consumed_at = now()
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING serial_number`,
    [tokenHash]
  );
  return res.rows[0]?.serial_number || null;
}

async function linkDeviceToUserBySerial(userId, serial) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO managed_devices (serial_number)
       VALUES ($1)
       ON CONFLICT (serial_number)
       DO UPDATE SET updated_at = now()`,
      [serial]
    );

    await client.query(
      `UPDATE user_device_links
       SET is_active = false,
           unlinked_at = now(),
           unlink_reason = 'reassigned'
       WHERE serial_number = $1
         AND is_active = true
         AND user_id <> $2`,
      [serial, userId]
    );

    await client.query(
      `INSERT INTO user_device_links (user_id, serial_number, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, serial_number, is_active)
       DO NOTHING`,
      [userId, serial]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  ensureConnected,
  findUserByEmail,
  createUser,
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
  listAllParentStudentPairs,
  upsertParentAiReport,
  getLatestParentAiReport,
  createWebclipSession,
  consumeWebclipSession,
  linkDeviceToUserBySerial,
  getOrCreateStudyDay,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData
};


