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
  const res = await client.query(
    `INSERT INTO study_days (user_id, date)
     VALUES ($1, $2)
     ON CONFLICT (user_id, date)
     DO UPDATE SET date = EXCLUDED.date
     RETURNING *`,
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

async function getActiveDeviceSerialForUser(userId) {
  const res = await query(
    `SELECT serial_number
     FROM user_device_links
     WHERE user_id = $1
       AND is_active = true
     ORDER BY linked_at DESC
     LIMIT 1`,
    [userId]
  );
  return res.rows[0]?.serial_number || null;
}

async function getParentPlannerRule(parentUserId, studentUserId) {
  const res = await query(
    `SELECT enabled, lock_time, updated_at
     FROM parent_planner_rules
     WHERE parent_user_id = $1 AND student_user_id = $2`,
    [parentUserId, studentUserId]
  );
  return (
    res.rows[0] || {
      enabled: true,
      lock_time: "21:00",
      updated_at: null
    }
  );
}

async function upsertParentPlannerRule(
  parentUserId,
  studentUserId,
  enabled,
  lockTime
) {
  const res = await query(
    `INSERT INTO parent_planner_rules
      (parent_user_id, student_user_id, enabled, lock_time, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (parent_user_id, student_user_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       lock_time = EXCLUDED.lock_time,
       updated_at = now()
     RETURNING enabled, lock_time, updated_at`,
    [parentUserId, studentUserId, enabled, lockTime]
  );
  return res.rows[0];
}

async function listPlannerRulesForStudent(studentUserId) {
  const res = await query(
    `SELECT p.user_id AS parent_user_id,
            ps.student_id AS student_user_id,
            COALESCE(r.enabled, true) AS enabled,
            COALESCE(r.lock_time, '21:00') AS lock_time,
            r.updated_at
     FROM parents_students ps
     JOIN parents p
       ON p.id = ps.parent_id
     LEFT JOIN parent_planner_rules r
       ON r.parent_user_id = p.user_id
      AND r.student_user_id = ps.student_id
     WHERE ps.student_id = $1
     ORDER BY p.user_id ASC`,
    [studentUserId]
  );
  return res.rows;
}

async function listAllPlannerRules() {
  const res = await query(
    `SELECT p.user_id AS parent_user_id,
            ps.student_id AS student_user_id,
            COALESCE(r.enabled, true) AS enabled,
            COALESCE(r.lock_time, '21:00') AS lock_time,
            r.updated_at
     FROM parents_students ps
     JOIN parents p
       ON p.id = ps.parent_id
     LEFT JOIN parent_planner_rules r
       ON r.parent_user_id = p.user_id
      AND r.student_user_id = ps.student_id
     ORDER BY ps.student_id ASC, p.user_id ASC`
  );
  return res.rows;
}

async function getLatestPlannerLockSession(parentUserId, studentUserId) {
  const res = await query(
    `SELECT id,
            parent_user_id,
            student_user_id,
            device_link_mode,
            provider,
            scheduled_for,
            locked_at,
            unlocked_at,
            status,
            reason,
            mdm_payload,
            created_at,
            updated_at
     FROM planner_lock_sessions
     WHERE parent_user_id = $1
       AND student_user_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [parentUserId, studentUserId]
  );
  return res.rows[0] || null;
}

async function listLatestPlannerLockSessionsForStudent(studentUserId) {
  const res = await query(
    `SELECT DISTINCT ON (parent_user_id)
            id,
            parent_user_id,
            student_user_id,
            device_link_mode,
            provider,
            scheduled_for,
            locked_at,
            unlocked_at,
            status,
            reason,
            mdm_payload,
            created_at,
            updated_at
     FROM planner_lock_sessions
     WHERE student_user_id = $1
     ORDER BY parent_user_id, created_at DESC, id DESC`,
    [studentUserId]
  );
  return res.rows;
}

async function createPlannerLockSession(input) {
  const res = await query(
    `INSERT INTO planner_lock_sessions
      (parent_user_id, student_user_id, device_link_mode, provider, scheduled_for,
       locked_at, unlocked_at, status, reason, mdm_payload, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
     RETURNING id, parent_user_id, student_user_id, device_link_mode, provider,
               scheduled_for, locked_at, unlocked_at, status, reason, mdm_payload,
               created_at, updated_at`,
    [
      input.parentUserId,
      input.studentUserId,
      input.deviceLinkMode || "unknown",
      input.provider || "simplemdm",
      input.scheduledFor || null,
      input.lockedAt || null,
      input.unlockedAt || null,
      input.status,
      input.reason || null,
      JSON.stringify(input.mdmPayload || {})
    ]
  );
  return res.rows[0];
}

async function updatePlannerLockSession(sessionId, patch) {
  const current = await query(
    `SELECT id,
            parent_user_id,
            student_user_id,
            device_link_mode,
            provider,
            scheduled_for,
            locked_at,
            unlocked_at,
            status,
            reason,
            mdm_payload,
            created_at,
            updated_at
     FROM planner_lock_sessions
     WHERE id = $1
     LIMIT 1`,
    [sessionId]
  );
  const row = current.rows[0];
  if (!row) return null;
  const next = {
    device_link_mode: patch.deviceLinkMode ?? row.device_link_mode,
    provider: patch.provider ?? row.provider,
    scheduled_for: patch.scheduledFor ?? row.scheduled_for,
    locked_at: patch.lockedAt ?? row.locked_at,
    unlocked_at: patch.unlockedAt ?? row.unlocked_at,
    status: patch.status ?? row.status,
    reason: patch.reason ?? row.reason,
    mdm_payload:
      patch.mdmPayload === undefined ? row.mdm_payload : patch.mdmPayload || {}
  };
  const res = await query(
    `UPDATE planner_lock_sessions
     SET device_link_mode = $2,
         provider = $3,
         scheduled_for = $4,
         locked_at = $5,
         unlocked_at = $6,
         status = $7,
         reason = $8,
         mdm_payload = $9::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING id, parent_user_id, student_user_id, device_link_mode, provider,
               scheduled_for, locked_at, unlocked_at, status, reason, mdm_payload,
               created_at, updated_at`,
    [
      sessionId,
      next.device_link_mode,
      next.provider,
      next.scheduled_for,
      next.locked_at,
      next.unlocked_at,
      next.status,
      next.reason,
      JSON.stringify(next.mdm_payload || {})
    ]
  );
  return res.rows[0] || null;
}

async function hasStudyPlanContentForDate(userId, date) {
  const res = await query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM study_days sd
         JOIN study_blocks sb ON sb.study_day_id = sd.id
         WHERE sd.user_id = $1
           AND sd.date = $2
       ) AS has_blocks,
       EXISTS (
         SELECT 1
         FROM study_days sd
         JOIN study_plans sp ON sp.study_day_id = sd.id
         WHERE sd.user_id = $1
           AND sd.date = $2
           AND COALESCE(NULLIF(BTRIM(sp.planned_range), ''), NULLIF(sp.start_time, ''), NULLIF(sp.end_time, '')) IS NOT NULL
       ) AS has_plans`,
    [userId, date]
  );
  const row = res.rows[0] || {};
  return Boolean(row.has_blocks || row.has_plans);
}

const defaultStoreApps = [
  {
    appKey: "youtube-learning",
    name: "YouTube",
    category: "강의",
    description: "개념 강의와 문제 풀이 영상을 빠르게 찾아볼 수 있어요.",
    url: "https://www.youtube.com",
    bundleId: "com.google.ios.youtube",
    appStoreId: 544007664,
    simplemdmAppId: null,
    sortOrder: 1
  },
  {
    appKey: "khan-academy",
    name: "Khan Academy",
    category: "수학/과학",
    description: "기초부터 심화까지 단계별 학습이 가능한 무료 강의 플랫폼입니다.",
    url: "https://www.khanacademy.org",
    bundleId: "org.khanacademy.Khan-Academy",
    appStoreId: 469863705,
    simplemdmAppId: null,
    sortOrder: 2
  },
  {
    appKey: "quizlet",
    name: "Quizlet",
    category: "암기",
    description: "단어장과 플래시카드로 반복 암기 루틴을 만들 수 있어요.",
    url: "https://quizlet.com",
    bundleId: "com.quizlet.quizletiphone",
    appStoreId: 546473125,
    simplemdmAppId: null,
    sortOrder: 3
  },
  {
    appKey: "notion",
    name: "Notion",
    category: "정리",
    description: "과목별 개념 노트와 학습 체크리스트를 체계적으로 관리할 수 있어요.",
    url: "https://www.notion.so",
    bundleId: "notion.id",
    appStoreId: 1232780281,
    simplemdmAppId: null,
    sortOrder: 4
  },
  {
    appKey: "google-drive",
    name: "Google Drive",
    category: "자료관리",
    description: "학습 자료를 저장하고 기기 간 동기화할 수 있어요.",
    url: "https://drive.google.com",
    bundleId: "com.google.Drive",
    appStoreId: 507874739,
    simplemdmAppId: null,
    sortOrder: 5
  }
];

async function ensureDefaultStoreApps() {
  if (ensureDefaultStoreApps._seeded) return;
  for (const app of defaultStoreApps) {
    await query(
      `INSERT INTO store_apps (app_key, name, category, description, url, bundle_id, app_store_id, simplemdm_app_id, sort_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
       ON CONFLICT (app_key)
       DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         url = EXCLUDED.url,
         bundle_id = COALESCE(store_apps.bundle_id, EXCLUDED.bundle_id),
         app_store_id = COALESCE(store_apps.app_store_id, EXCLUDED.app_store_id),
         simplemdm_app_id = COALESCE(store_apps.simplemdm_app_id, EXCLUDED.simplemdm_app_id),
         sort_order = EXCLUDED.sort_order,
         updated_at = now()`,
      [
        app.appKey,
        app.name,
        app.category,
        app.description,
        app.url,
        app.bundleId,
        app.appStoreId,
        app.simplemdmAppId,
        app.sortOrder
      ]
    );
  }
  ensureDefaultStoreApps._seeded = true;
}

async function listStoreAppsForUser(userId) {
  await ensureDefaultStoreApps();
  const res = await query(
    `SELECT sa.id,
            sa.app_key,
            sa.name,
            sa.category,
            sa.description,
            sa.url,
            sa.bundle_id,
            sa.app_store_id,
            sa.simplemdm_app_id,
            sa.sort_order,
            COALESCE(ss.is_installed, false) AS is_installed,
            ss.installed_at,
            ss.removed_at,
            ss.updated_at
     FROM store_apps sa
     LEFT JOIN student_store_app_status ss
       ON ss.store_app_id = sa.id
      AND ss.user_id = $1
     WHERE sa.is_active = true
     ORDER BY sa.sort_order ASC, sa.name ASC`,
    [userId]
  );
  return res.rows;
}

async function setStoreAppInstalled(userId, appKey, isInstalled) {
  await ensureDefaultStoreApps();
  const appRes = await query(
    `SELECT id, app_key, name, category, description, url, bundle_id, app_store_id, sort_order
            , simplemdm_app_id
     FROM store_apps
     WHERE app_key = $1
       AND is_active = true
     LIMIT 1`,
    [appKey]
  );
  const app = appRes.rows[0];
  if (!app) return null;
  const statusRes = await query(
    `INSERT INTO student_store_app_status
      (user_id, store_app_id, is_installed, installed_at, removed_at, updated_at)
     VALUES (
      $1,
      $2,
      $3,
      CASE WHEN $3 THEN now() ELSE NULL END,
      CASE WHEN $3 THEN NULL ELSE now() END,
      now()
     )
     ON CONFLICT (user_id, store_app_id)
     DO UPDATE SET
       is_installed = EXCLUDED.is_installed,
       installed_at = CASE
         WHEN EXCLUDED.is_installed THEN now()
         ELSE student_store_app_status.installed_at
       END,
       removed_at = CASE
         WHEN EXCLUDED.is_installed THEN NULL
         ELSE now()
       END,
       updated_at = now()
     RETURNING is_installed, installed_at, removed_at, updated_at`,
    [userId, app.id, isInstalled]
  );
  return { ...app, ...statusRes.rows[0] };
}

async function getStoreAppByKey(appKey) {
  await ensureDefaultStoreApps();
  const res = await query(
    `SELECT id, app_key, name, category, description, url, bundle_id, app_store_id, simplemdm_app_id, sort_order
     FROM store_apps
     WHERE app_key = $1
       AND is_active = true
     LIMIT 1`,
    [appKey]
  );
  return res.rows[0] || null;
}

async function updateStoreAppSimpleMdmId(appKey, simpleMdmAppId) {
  const res = await query(
    `UPDATE store_apps
     SET simplemdm_app_id = $2,
         updated_at = now()
     WHERE app_key = $1
     RETURNING id, app_key, name, category, description, url, bundle_id, app_store_id, simplemdm_app_id, sort_order`,
    [appKey, simpleMdmAppId]
  );
  return res.rows[0] || null;
}

async function getStudentMdmGroup(userId) {
  const res = await query(
    `SELECT assignment_group_id, assignment_group_name
     FROM student_mdm_groups
     WHERE user_id = $1
       AND provider = 'simplemdm'
     LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function upsertStudentMdmGroup(userId, assignmentGroupId, assignmentGroupName) {
  const res = await query(
    `INSERT INTO student_mdm_groups
      (user_id, provider, assignment_group_id, assignment_group_name, updated_at)
     VALUES ($1, 'simplemdm', $2, $3, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       assignment_group_id = EXCLUDED.assignment_group_id,
       assignment_group_name = EXCLUDED.assignment_group_name,
       updated_at = now()
     RETURNING assignment_group_id, assignment_group_name`,
    [userId, assignmentGroupId, assignmentGroupName]
  );
  return res.rows[0];
}

async function upsertStudentCoachProfile(userId, input = {}) {
  const res = await query(
    `INSERT INTO student_coach_profiles
      (user_id, name, school_level, grade, goal, target_subjects, weak_subjects, sleep_time, wake_time, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       name = COALESCE(EXCLUDED.name, student_coach_profiles.name),
       school_level = COALESCE(EXCLUDED.school_level, student_coach_profiles.school_level),
       grade = COALESCE(EXCLUDED.grade, student_coach_profiles.grade),
       goal = COALESCE(EXCLUDED.goal, student_coach_profiles.goal),
       target_subjects = COALESCE(EXCLUDED.target_subjects, student_coach_profiles.target_subjects),
       weak_subjects = COALESCE(EXCLUDED.weak_subjects, student_coach_profiles.weak_subjects),
       sleep_time = COALESCE(EXCLUDED.sleep_time, student_coach_profiles.sleep_time),
       wake_time = COALESCE(EXCLUDED.wake_time, student_coach_profiles.wake_time),
       updated_at = now()
     RETURNING *`,
    [
      userId,
      input.name || null,
      input.schoolLevel || null,
      Number.isFinite(Number(input.grade)) ? Number(input.grade) : null,
      input.goal || null,
      Array.isArray(input.targetSubjects) ? input.targetSubjects : [],
      Array.isArray(input.weakSubjects) ? input.weakSubjects : [],
      input.sleepTime || null,
      input.wakeTime || null
    ]
  );
  return res.rows[0] || null;
}

async function getStudentCoachProfile(userId) {
  const res = await query(
    `SELECT * FROM student_coach_profiles WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function insertStudentCoachLog(userId, log = {}) {
  const res = await query(
    `INSERT INTO student_coach_logs
      (user_id, log_date, sleep_hours, steps, meals_regularity, concentration_score, stress_score, phone_distractions, study_minutes, plan_completion_rate, memo)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      userId,
      log.date || null,
      Number.isFinite(Number(log.sleepHours)) ? Number(log.sleepHours) : null,
      Number.isFinite(Number(log.steps)) ? Number(log.steps) : null,
      Number.isFinite(Number(log.mealsRegularity)) ? Number(log.mealsRegularity) : null,
      Number.isFinite(Number(log.concentrationScore)) ? Number(log.concentrationScore) : null,
      Number.isFinite(Number(log.stressScore)) ? Number(log.stressScore) : null,
      Number.isFinite(Number(log.phoneDistractions)) ? Number(log.phoneDistractions) : null,
      Number.isFinite(Number(log.studyMinutes)) ? Number(log.studyMinutes) : null,
      Number.isFinite(Number(log.planCompletionRate)) ? Number(log.planCompletionRate) : null,
      log.memo || null
    ]
  );
  return res.rows[0] || null;
}

async function listRecentStudentCoachLogs(userId, limit = 14) {
  const res = await query(
    `SELECT *
     FROM student_coach_logs
     WHERE user_id = $1
     ORDER BY log_date DESC, created_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Number(limit) || 14)]
  );
  return res.rows;
}

async function insertStudentCoachMessage(userId, role, content) {
  const res = await query(
    `INSERT INTO student_coach_messages (user_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, role, content]
  );
  return res.rows[0] || null;
}

async function listRecentStudentCoachMessages(userId, limit = 20) {
  const res = await query(
    `SELECT id, role, content, created_at
     FROM student_coach_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Number(limit) || 20)]
  );
  return res.rows.reverse();
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
  getActiveDeviceSerialForUser,
  getParentPlannerRule,
  upsertParentPlannerRule,
  listPlannerRulesForStudent,
  listAllPlannerRules,
  getLatestPlannerLockSession,
  listLatestPlannerLockSessionsForStudent,
  createPlannerLockSession,
  updatePlannerLockSession,
  hasStudyPlanContentForDate,
  listStoreAppsForUser,
  getStoreAppByKey,
  updateStoreAppSimpleMdmId,
  setStoreAppInstalled,
  getStudentMdmGroup,
  upsertStudentMdmGroup,
  upsertStudentCoachProfile,
  getStudentCoachProfile,
  insertStudentCoachLog,
  listRecentStudentCoachLogs,
  insertStudentCoachMessage,
  listRecentStudentCoachMessages,
  getOrCreateStudyDay,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData
};


