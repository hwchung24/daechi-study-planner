const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

/** 마이그레이션 전 DB는 book_id/planned_range 컬럼이 없을 수 있음. true만 캐시(마이그레이션 후 재시작 없이 감지). */
let cachedStudyBlocksExtendedCols = false;

async function studyBlocksHasExtendedCols() {
  if (cachedStudyBlocksExtendedCols) return true;
  try {
    const r = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'study_blocks'
         AND column_name = 'book_id'
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      cachedStudyBlocksExtendedCols = true;
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

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
    `SELECT u.id,
            u.email,
            u.role,
            scp.name,
            scp.grade,
            scp.goal,
            COALESCE(scp.initial_profile_completed, false) AS initial_profile_completed
     FROM users u
     LEFT JOIN student_coach_profiles scp ON scp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function getUserByIdForAuth(userId) {
  const res = await query(
    "SELECT id, email, password_hash, role FROM users WHERE id = $1",
    [userId]
  );
  return res.rows[0] || null;
}

async function updateUserEmail(userId, newEmail) {
  const trimmed = String(newEmail).trim().toLowerCase();
  const res = await query(
    "UPDATE users SET email = $1 WHERE id = $2 RETURNING id, email, role",
    [trimmed, userId]
  );
  return res.rows[0] || null;
}

async function updateUserPasswordHash(userId, passwordHash) {
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    passwordHash,
    userId
  ]);
}

async function deleteUser(userId) {
  const res = await query("DELETE FROM users WHERE id = $1", [userId]);
  return res.rowCount > 0;
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
    `SELECT u.id,
            u.email,
            pssr.name AS study_room_name,
            pssr.address AS study_room_address,
            pssr.latitude AS study_room_latitude,
            pssr.longitude AS study_room_longitude,
          pssr.radius_meters AS study_room_radius_meters,
            pssr.updated_at AS study_room_updated_at
     FROM parents_students ps
     JOIN users u ON u.id = ps.student_id
     LEFT JOIN parent_student_study_rooms pssr
       ON pssr.parent_user_id = $2 AND pssr.student_user_id = u.id
     WHERE ps.parent_id = $1
     ORDER BY u.email ASC`,
    [parent.id, parentUserId]
  );
  return res.rows.map(row => ({
    id: Number(row.id),
    email: String(row.email || ""),
    studyRoom:
      row.study_room_name &&
      Number.isFinite(Number(row.study_room_latitude)) &&
      Number.isFinite(Number(row.study_room_longitude))
        ? {
            studentId: Number(row.id),
            studentEmail: String(row.email || ""),
            name: String(row.study_room_name || ""),
            address: row.study_room_address != null ? String(row.study_room_address) : null,
            latitude: Number(row.study_room_latitude),
            longitude: Number(row.study_room_longitude),
            radiusMeters:
              row.study_room_radius_meters != null && Number.isFinite(Number(row.study_room_radius_meters))
                ? Number(row.study_room_radius_meters)
                : 120,
            updatedAt: row.study_room_updated_at
              ? new Date(row.study_room_updated_at).toISOString()
              : new Date().toISOString()
          }
        : null
  }));
}

async function upsertParentStudentStudyRoom(parentUserId, studentUserId, input = {}) {
  const res = await query(
    `INSERT INTO parent_student_study_rooms
      (parent_user_id, student_user_id, name, address, latitude, longitude, radius_meters, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (parent_user_id, student_user_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       address = EXCLUDED.address,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       radius_meters = EXCLUDED.radius_meters,
       updated_at = now()
     RETURNING *`,
    [
      parentUserId,
      studentUserId,
      String(input.name || "").trim(),
      input.address != null && String(input.address).trim()
        ? String(input.address).trim()
        : null,
      Number(input.latitude),
      Number(input.longitude),
      Math.min(1000, Math.max(30, Number(input.radiusMeters) || 120))
    ]
  );
  return res.rows[0] || null;
}

async function deleteParentStudentStudyRoom(parentUserId, studentUserId) {
  const res = await query(
    `DELETE FROM parent_student_study_rooms
     WHERE parent_user_id = $1 AND student_user_id = $2`,
    [parentUserId, studentUserId]
  );
  return res.rowCount > 0;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = value => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

async function listStudyRoomConfigurationsForStudent(studentUserId) {
  const res = await query(
    `SELECT pssr.id,
            pssr.parent_user_id,
            pssr.student_user_id,
            pssr.name,
            pssr.address,
            pssr.latitude,
            pssr.longitude,
          pssr.radius_meters,
            pssr.updated_at,
            pu.email AS parent_email
     FROM parent_student_study_rooms pssr
     JOIN users pu ON pu.id = pssr.parent_user_id
     WHERE pssr.student_user_id = $1
     ORDER BY pssr.updated_at DESC`,
    [studentUserId]
  );
  return res.rows;
}

function serializeStudyRoomVisitSession(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    parentUserId: Number(row.parent_user_id),
    studentUserId: Number(row.student_user_id),
    studyRoomId:
      row.study_room_id != null && Number.isFinite(Number(row.study_room_id))
        ? Number(row.study_room_id)
        : null,
    studyRoomName: String(row.study_room_name || row.study_room_snapshot_name || "독서실").trim() || "독서실",
    parentEmail: String(row.parent_email || "").trim(),
    enteredAt: row.entered_at ? new Date(row.entered_at).toISOString() : new Date().toISOString(),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : new Date().toISOString(),
    exitedAt: row.exited_at ? new Date(row.exited_at).toISOString() : null,
    exitReason: row.exit_reason != null ? String(row.exit_reason) : null,
    lastDistanceMeters:
      row.last_distance_meters != null && Number.isFinite(Number(row.last_distance_meters))
        ? Number(row.last_distance_meters)
        : null
  };
}

async function recordStudentStudyRoomHeartbeat(studentUserId, input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("invalid_location");
  }
  const occurredAtRaw = input.occurredAt || input.timestamp || null;
  const occurredAt = occurredAtRaw ? new Date(String(occurredAtRaw)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("invalid_timestamp");
  }
  const studyRooms = await listStudyRoomConfigurationsForStudent(studentUserId);
  const activeRes = await query(
    `SELECT *
     FROM parent_student_study_room_visit_sessions
     WHERE student_user_id = $1 AND exited_at IS NULL`,
    [studentUserId]
  );
  const activeByKey = new Map(
    activeRes.rows.map(row => [
      `${Number(row.parent_user_id)}:${Number(row.study_room_id)}`,
      row
    ])
  );
  const nearbyRooms = [];
  for (const room of studyRooms) {
    const distanceMeters = haversineMeters(
      latitude,
      longitude,
      Number(room.latitude),
      Number(room.longitude)
    );
    const radiusMeters = Math.min(
      1000,
      Math.max(30, Number(room.radius_meters) || 120)
    );
    const isNearby = distanceMeters <= radiusMeters;
    const key = `${Number(room.parent_user_id)}:${Number(room.id)}`;
    const active = activeByKey.get(key) || null;
    if (isNearby) {
      nearbyRooms.push({ room, distanceMeters });
      if (active) {
        await query(
          `UPDATE parent_student_study_room_visit_sessions
           SET last_seen_at = GREATEST(last_seen_at, $4::timestamptz),
               last_distance_meters = $5,
               updated_at = now()
           WHERE id = $1`,
          [active.id, room.parent_user_id, studentUserId, occurredAt.toISOString(), distanceMeters]
        );
      } else {
        await query(
          `INSERT INTO parent_student_study_room_visit_sessions
            (parent_user_id, student_user_id, study_room_id, entered_at, last_seen_at, last_distance_meters, updated_at)
           VALUES ($1, $2, $3, $4, $4, $5, now())`,
          [room.parent_user_id, studentUserId, room.id, occurredAt.toISOString(), distanceMeters]
        );
      }
      continue;
    }
    if (active) {
      await query(
        `UPDATE parent_student_study_room_visit_sessions
         SET exited_at = COALESCE(exited_at, $2::timestamptz),
             exit_reason = COALESCE(exit_reason, 'outside_radius'),
             updated_at = now(),
             last_distance_meters = $3
         WHERE id = $1`,
        [active.id, occurredAt.toISOString(), distanceMeters]
      );
    }
  }
  return {
    studyRoomCount: studyRooms.length,
    nearbyStudyRoomCount: nearbyRooms.length
  };
}

async function listRecentStudyRoomVisitSessionsForStudent(studentUserId, limit = 20) {
  const res = await query(
    `SELECT s.id,
            s.parent_user_id,
            s.student_user_id,
            s.study_room_id,
            s.entered_at,
            s.last_seen_at,
            s.exited_at,
            s.exit_reason,
            s.last_distance_meters,
            pu.email AS parent_email,
            COALESCE(pssr.name, '독서실') AS study_room_name
     FROM parent_student_study_room_visit_sessions s
     JOIN users pu ON pu.id = s.parent_user_id
     LEFT JOIN parent_student_study_rooms pssr ON pssr.id = s.study_room_id
     WHERE s.student_user_id = $1
     ORDER BY s.entered_at DESC
     LIMIT $2`,
    [studentUserId, limit]
  );
  return res.rows.map(serializeStudyRoomVisitSession);
}

async function listRecentStudyRoomVisitSessionsForParent(parentUserId, studentUserId, limit = 20) {
  const res = await query(
    `SELECT s.id,
            s.parent_user_id,
            s.student_user_id,
            s.study_room_id,
            s.entered_at,
            s.last_seen_at,
            s.exited_at,
            s.exit_reason,
            s.last_distance_meters,
            pu.email AS parent_email,
            COALESCE(pssr.name, '독서실') AS study_room_name
     FROM parent_student_study_room_visit_sessions s
     JOIN users pu ON pu.id = s.parent_user_id
     LEFT JOIN parent_student_study_rooms pssr ON pssr.id = s.study_room_id
     WHERE s.parent_user_id = $1 AND s.student_user_id = $2
     ORDER BY s.entered_at DESC
     LIMIT $3`,
    [parentUserId, studentUserId, limit]
  );
  return res.rows.map(serializeStudyRoomVisitSession);
}

async function listStudentParents(studentUserId) {
  const res = await query(
    `SELECT u.id, u.email
     FROM parents_students ps
     JOIN parents p ON p.id = ps.parent_id
     JOIN users u ON u.id = p.user_id
     WHERE ps.student_id = $1
     ORDER BY u.email ASC`,
    [studentUserId]
  );
  return res.rows;
}

async function listLinkedParentUserIdsForStudent(studentUserId) {
  const res = await query(
    `SELECT DISTINCT p.user_id
     FROM parents_students ps
     JOIN parents p ON p.id = ps.parent_id
     WHERE ps.student_id = $1`,
    [studentUserId]
  );
  return res.rows.map(row => Number(row.user_id)).filter(Number.isFinite);
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
  if (Number(row.student_user_id) !== Number(studentUserId)) {
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
  if (Number(row.parent_user_id) !== Number(parentUserId)) {
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
  if (Number(row.parent_user_id) !== Number(userId) && Number(row.student_user_id) !== Number(userId)) {
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
  const hasExtended = await studyBlocksHasExtendedCols();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await getOrCreateStudyDayWithClient(client, userId, date);
    await client.query("DELETE FROM study_blocks WHERE study_day_id = $1", [
      day.id
    ]);
    if (hasExtended) {
      const insertText =
        "INSERT INTO study_blocks (study_day_id, subject, start_time, end_time, done, focus_score, book_id, planned_range) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";
      for (const b of blocks) {
        const bid =
          b.bookId != null && b.bookId !== ""
            ? Number(b.bookId)
            : null;
        const pr =
          b.plannedRange != null && String(b.plannedRange).trim() !== ""
            ? String(b.plannedRange).trim()
            : null;
        await client.query(insertText, [
          day.id,
          b.subject,
          b.startTime,
          b.endTime,
          !!b.done,
          b.focusScore || null,
          Number.isFinite(bid) ? bid : null,
          pr
        ]);
      }
    } else {
      const insertLegacy =
        "INSERT INTO study_blocks (study_day_id, subject, start_time, end_time, done, focus_score) VALUES ($1, $2, $3, $4, $5, $6)";
      for (const b of blocks) {
        await client.query(insertLegacy, [
          day.id,
          b.subject,
          b.startTime,
          b.endTime,
          !!b.done,
          b.focusScore || null
        ]);
      }
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
         ON CONFLICT (user_id, name) DO UPDATE SET
           active = true,
           name = EXCLUDED.name
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
    `SELECT sp.*, sb.name AS book_name
     FROM study_plans sp
     INNER JOIN study_books sb ON sb.id = sp.book_id AND sb.active = true
     WHERE sp.study_day_id IN (${params})`,
    ids
  );
  return { days, blocks: blocksRes.rows, plans: plansRes.rows };
}

/** 특정 날짜(YYYY-MM-DD)의 study_plans만 조회 — 주간 API와 무관하게 내일 계획 복원용 */
async function getStudyPlansForDate(userId, dateStr) {
  const d = String(dateStr || "")
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { plans: [] };
  /** date 컬럼이 TEXT/DATE/타임존 문자열 등일 때도 YYYY-MM-DD 로 맞춤 */
  const dayRes = await query(
    `SELECT sd.id FROM study_days sd
     WHERE sd.user_id = $1
       AND left(split_part(trim(COALESCE(sd.date::text, '')), 'T', 1), 10) = $2`,
    [userId, d]
  );
  if (dayRes.rows.length === 0) {
    return { plans: [] };
  }
  const studyDayId = dayRes.rows[0].id;
  /** 책 비활성화돼도 계획 행은 보이게 (INNER + active 조건이면 행 자체가 사라짐) */
  const plansRes = await query(
    `SELECT sp.*, sb.name AS book_name
     FROM study_plans sp
     LEFT JOIN study_books sb ON sb.id = sp.book_id
     WHERE sp.study_day_id = $1`,
    [studyDayId]
  );
  return { plans: plansRes.rows };
}

async function listStudyBooks(userId) {
  const res = await query(
    `SELECT id, name FROM study_books
     WHERE user_id = $1 AND active = true
     ORDER BY id ASC`,
    [userId]
  );
  return res.rows;
}

async function listStudentProfileSchedules(userId) {
  const res = await query(
    `SELECT id, title, schedule_date, start_time, end_time, is_recurring,
            recurrence_rule, excluded_dates, source, note, created_at, updated_at
     FROM student_profile_schedules
     WHERE user_id = $1
     ORDER BY schedule_date ASC, start_time ASC, created_at ASC`,
    [userId]
  );
  return res.rows;
}

async function createStudentProfileSchedule(userId, input) {
  const title = String(input?.title || "").trim().slice(0, 120);
  const scheduleDate = String(input?.date || "").trim().slice(0, 10);
  const startTime = String(input?.startTime || "").trim().slice(0, 5);
  const endTime = String(input?.endTime || "").trim().slice(0, 5);
  const recurrenceRule = String(input?.recurrenceRule || "").trim().slice(0, 120);
  const source = input?.source === "ai" ? "ai" : "manual";
  const note = String(input?.note || "").trim().slice(0, 300);
  if (!title) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(startTime)) return null;
  if (!/^\d{2}:\d{2}$/.test(endTime)) return null;
  const recurring = Boolean(input?.isRecurring);
  const res = await query(
    `INSERT INTO student_profile_schedules
     (user_id, title, schedule_date, start_time, end_time, is_recurring, recurrence_rule, excluded_dates, source, note)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, '{}'::text[], $8, $9)
     RETURNING id, title, schedule_date, start_time, end_time, is_recurring,
               recurrence_rule, excluded_dates, source, note, created_at, updated_at`,
    [
      userId,
      title,
      scheduleDate,
      startTime,
      endTime,
      recurring,
      recurrenceRule || null,
      source,
      note || null
    ]
  );
  return res.rows[0] || null;
}

async function updateStudentProfileSchedule(userId, scheduleId, input) {
  const title = String(input?.title || "").trim().slice(0, 120);
  const scheduleDate = String(input?.date || "").trim().slice(0, 10);
  const startTime = String(input?.startTime || "").trim().slice(0, 5);
  const endTime = String(input?.endTime || "").trim().slice(0, 5);
  const recurrenceRule = String(input?.recurrenceRule || "").trim().slice(0, 120);
  const note = String(input?.note || "").trim().slice(0, 300);
  if (!title) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(startTime)) return null;
  if (!/^\d{2}:\d{2}$/.test(endTime)) return null;
  const recurring = Boolean(input?.isRecurring);
  const res = await query(
    `UPDATE student_profile_schedules
     SET title = $3,
         schedule_date = $4::date,
         start_time = $5,
         end_time = $6,
         is_recurring = $7,
         recurrence_rule = $8,
         note = $9,
         updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING id, title, schedule_date, start_time, end_time, is_recurring,
               recurrence_rule, excluded_dates, source, note, created_at, updated_at`,
    [
      userId,
      scheduleId,
      title,
      scheduleDate,
      startTime,
      endTime,
      recurring,
      recurrenceRule || null,
      note || null
    ]
  );
  return res.rows[0] || null;
}

async function cancelStudentProfileScheduleOccurrence(userId, scheduleId, occurrenceDate) {
  const dateText = String(occurrenceDate || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const res = await query(
    `UPDATE student_profile_schedules
     SET excluded_dates = CASE
         WHEN NOT ($3 = ANY(COALESCE(excluded_dates, '{}'::text[])))
           THEN array_append(COALESCE(excluded_dates, '{}'::text[]), $3)
         ELSE COALESCE(excluded_dates, '{}'::text[])
       END,
       updated_at = now()
     WHERE user_id = $1 AND id = $2 AND is_recurring = true
     RETURNING id, title, schedule_date, start_time, end_time, is_recurring,
               recurrence_rule, excluded_dates, source, note, created_at, updated_at`,
    [userId, scheduleId, dateText]
  );
  return res.rows[0] || null;
}

async function deleteStudentProfileSchedule(userId, scheduleId) {
  const res = await query(
    `DELETE FROM student_profile_schedules WHERE user_id = $1 AND id = $2`,
    [userId, scheduleId]
  );
  return res.rowCount > 0;
}

async function createStudyBook(userId, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const res = await query(
    `INSERT INTO study_books (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET active = true
     RETURNING id, name`,
    [userId, trimmed]
  );
  return res.rows[0] || null;
}

async function softDeleteStudyBook(userId, bookId) {
  const res = await query(
    `UPDATE study_books SET active = false WHERE id = $1 AND user_id = $2`,
    [bookId, userId]
  );
  return res.rowCount > 0;
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
           AND (
             NULLIF(BTRIM(COALESCE(sp.planned_range, '')), '') IS NOT NULL
             OR NULLIF(TRIM(COALESCE(sp.start_time::text, '')), '') IS NOT NULL
             OR NULLIF(TRIM(COALESCE(sp.end_time::text, '')), '') IS NOT NULL
           )
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
      (user_id, name, school_level, grade, goal, target_subjects, weak_subjects, sleep_time, wake_time, initial_profile_completed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, $10, now())
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
       initial_profile_completed = COALESCE(
         EXCLUDED.initial_profile_completed,
         student_coach_profiles.initial_profile_completed
       ),
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
      input.wakeTime || null,
      Object.prototype.hasOwnProperty.call(input, "initialProfileCompleted")
        ? Boolean(input.initialProfileCompleted)
        : null
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
      (user_id, log_date, sleep_hours, steps, meals_regularity, concentration_score, stress_score, phone_distractions, study_minutes, plan_completion_rate, memo, tomorrow_practice, tomorrow_practice_done, study_evaluation, metacognition_reflection)
     VALUES ($1, COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
      log.memo || null,
      log.tomorrowPractice || null,
      Object.prototype.hasOwnProperty.call(log, "tomorrowPracticeDone")
        ? log.tomorrowPracticeDone === null || log.tomorrowPracticeDone === undefined
          ? null
          : Boolean(log.tomorrowPracticeDone)
        : null,
      log.studyEvaluation || null,
      log.metacognitionReflection || null
    ]
  );
  return res.rows[0] || null;
}

/** 같은 user+날짜는 하루 한 행만 유지 (재저장 시 그래프에 최신값 반영) */
async function upsertStudentCoachLog(userId, log = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prevRes = await client.query(
      `SELECT tomorrow_practice_done FROM student_coach_logs
       WHERE user_id = $1 AND log_date = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date)`,
      [userId, log.date || null]
    );
    const prevDone = prevRes.rows[0]?.tomorrow_practice_done;
    let mergedDone = prevDone ?? null;
    if (Object.prototype.hasOwnProperty.call(log, "tomorrowPracticeDone")) {
      mergedDone =
        log.tomorrowPracticeDone === null || log.tomorrowPracticeDone === undefined
          ? null
          : Boolean(log.tomorrowPracticeDone);
    }
    await client.query(
      `DELETE FROM student_coach_logs
       WHERE user_id = $1 AND log_date = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date)`,
      [userId, log.date || null]
    );
    const res = await client.query(
      `INSERT INTO student_coach_logs
        (user_id, log_date, sleep_hours, steps, meals_regularity, concentration_score, stress_score, phone_distractions, study_minutes, plan_completion_rate, memo, tomorrow_practice, tomorrow_practice_done, study_evaluation, metacognition_reflection)
       VALUES ($1, COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        log.memo || null,
        log.tomorrowPractice || null,
        mergedDone,
        log.studyEvaluation || null,
        log.metacognitionReflection || null
      ]
    );
    await client.query("COMMIT");
    return res.rows[0] || null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** 기록「내일 실천할 한 가지」만 갱신 (코치 계획 탭 반영 등, 다른 컬럼 유지) */
async function setStudentCoachLogTomorrowPractice(userId, text) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE student_coach_logs SET tomorrow_practice = $2
       WHERE user_id = $1 AND log_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date`,
      [userId, text || null]
    );
    if (upd.rowCount === 0) {
      await client.query(
        `INSERT INTO student_coach_logs (user_id, log_date, tomorrow_practice)
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date, $2)`,
        [userId, text || null]
      );
    }
    const sel = await client.query(
      `SELECT * FROM student_coach_logs
       WHERE user_id = $1 AND log_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
       LIMIT 1`,
      [userId]
    );
    await client.query("COMMIT");
    return sel.rows[0] || null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** 오늘 공부 탭에서 어제 적은 실천 약속 이행 여부만 갱신 (전체 기록 저장 없이) */
async function setStudentCoachLogTomorrowPracticeDone(userId, done) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE student_coach_logs SET tomorrow_practice_done = $2
       WHERE user_id = $1 AND log_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date`,
      [userId, Boolean(done)]
    );
    if (upd.rowCount === 0) {
      await client.query(
        `INSERT INTO student_coach_logs (user_id, log_date, tomorrow_practice_done)
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date, $2)`,
        [userId, Boolean(done)]
      );
    }
    const sel = await client.query(
      `SELECT * FROM student_coach_logs
       WHERE user_id = $1 AND log_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
       LIMIT 1`,
      [userId]
    );
    await client.query("COMMIT");
    return sel.rows[0] || null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
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

/** 이번 주(월요일 weekMondayIso ~ 일요일) 로그 — 앱 getWeekDays(0)과 날짜 키 일치 */
async function listStudentCoachLogsInWeekRange(userId, weekMondayIso) {
  const res = await query(
    `SELECT *
     FROM student_coach_logs
     WHERE user_id = $1
       AND log_date >= $2::date
       AND log_date <= ($2::date + interval '6 days')::date
     ORDER BY log_date DESC, created_at DESC`,
    [userId, weekMondayIso]
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

function hhmmFromDb(t) {
  const s = String(t ?? "").trim();
  if (!s) return "";
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function blockTimeSortKeyMin(t) {
  const m = String(t ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

async function getStudyBlocksReplacePayloadForDate(userId, dateStr) {
  const d = String(dateStr || "")
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return [];
  const dayRes = await query(
    `SELECT sd.id FROM study_days sd
     WHERE sd.user_id = $1
       AND left(split_part(trim(COALESCE(sd.date::text, '')), 'T', 1), 10) = $2`,
    [userId, d]
  );
  if (dayRes.rows.length === 0) return [];
  const studyDayId = dayRes.rows[0].id;
  const hasExtended = await studyBlocksHasExtendedCols();
  const sel = hasExtended
    ? "subject, start_time, end_time, done, focus_score, book_id, planned_range"
    : "subject, start_time, end_time, done, focus_score";
  const blocksRes = await query(
    `SELECT ${sel} FROM study_blocks WHERE study_day_id = $1 ORDER BY start_time ASC`,
    [studyDayId]
  );
  return blocksRes.rows.map(row => {
    const base = {
      subject: row.subject,
      startTime: hhmmFromDb(row.start_time),
      endTime: hhmmFromDb(row.end_time),
      done: !!row.done,
      focusScore: row.focus_score || null
    };
    if (hasExtended) {
      const bid = row.book_id;
      return {
        ...base,
        bookId: bid != null ? Number(bid) : null,
        plannedRange:
          row.planned_range != null && String(row.planned_range).trim() !== ""
            ? String(row.planned_range).trim()
            : null
      };
    }
    return base;
  });
}

function sortReplaceBlocks(blocks) {
  return [...blocks].sort(
    (a, b) => blockTimeSortKeyMin(a.startTime) - blockTimeSortKeyMin(b.startTime)
  );
}

async function countLinkedParentsForStudent(studentUserId) {
  const r = await query(
    `SELECT COUNT(*)::int AS c FROM parents_students WHERE student_id = $1`,
    [studentUserId]
  );
  return Number(r.rows[0]?.c) || 0;
}

async function getActiveStudyBookForStudent(userId, bookId) {
  const res = await query(
    `SELECT id, name FROM study_books WHERE id = $1 AND user_id = $2 AND active = true`,
    [bookId, userId]
  );
  return res.rows[0] || null;
}

async function createParentPlanAddRequest({
  studentUserId,
  targetDate,
  bookId,
  plannedRange,
  startTime,
  endTime,
  subjectSnapshot
}) {
  const hm = v => {
    const t = String(v ?? "").trim();
    return t.length >= 5 ? t.slice(0, 5) : t;
  };
  const res = await query(
    `INSERT INTO parent_plan_add_requests
     (student_user_id, target_date, book_id, planned_range, start_time, end_time, subject_snapshot, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [
      studentUserId,
      String(targetDate).slice(0, 10),
      bookId,
      plannedRange != null && String(plannedRange).trim() !== ""
        ? String(plannedRange).trim()
        : null,
      hm(startTime),
      hm(endTime),
      String(subjectSnapshot).trim()
    ]
  );
  return res.rows[0] || null;
}

async function listPendingPlanAddRequestsForParent(parentUserId) {
  const res = await query(
    `SELECT r.id, r.student_user_id, r.target_date, r.book_id, r.planned_range,
            r.start_time, r.end_time, r.subject_snapshot, r.created_at,
            u.email AS student_email
     FROM parent_plan_add_requests r
     INNER JOIN users u ON u.id = r.student_user_id
     INNER JOIN parents p ON p.user_id = $1
     INNER JOIN parents_students ps ON ps.parent_id = p.id AND ps.student_id = r.student_user_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at ASC`,
    [parentUserId]
  );
  return res.rows;
}

async function approvePlanAddRequestByParent(requestId, parentUserId) {
  const reqRow = await query(
    `SELECT * FROM parent_plan_add_requests WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  if (reqRow.rows.length === 0) {
    return { ok: false, error: "요청을 찾을 수 없거나 이미 처리되었습니다." };
  }
  const row = reqRow.rows[0];
  const studentId = Number(row.student_user_id);
  const has = await parentHasStudent(parentUserId, studentId);
  if (!has) {
    return { ok: false, error: "연결된 자녀의 요청만 처리할 수 있습니다." };
  }
  const bookCheck = await query(
    `SELECT id FROM study_books WHERE id = $1 AND user_id = $2 AND active = true`,
    [row.book_id, studentId]
  );
  if (bookCheck.rows.length === 0) {
    await query(
      `UPDATE parent_plan_add_requests SET status = 'rejected', resolved_at = now(),
       resolved_by_parent_user_id = $2 WHERE id = $1`,
      [requestId, parentUserId]
    );
    return { ok: false, error: "해당 책이 더 이상 없어 요청을 닫았습니다." };
  }
  const existing = await getStudyBlocksReplacePayloadForDate(
    studentId,
    row.target_date
  );
  const hasExtended = await studyBlocksHasExtendedCols();
  const newBlock = hasExtended
    ? {
        subject: row.subject_snapshot,
        startTime: hhmmFromDb(row.start_time),
        endTime: hhmmFromDb(row.end_time),
        done: false,
        focusScore: null,
        bookId: Number(row.book_id),
        plannedRange:
          row.planned_range != null && String(row.planned_range).trim() !== ""
            ? String(row.planned_range).trim()
            : null
      }
    : {
        subject: row.subject_snapshot,
        startTime: hhmmFromDb(row.start_time),
        endTime: hhmmFromDb(row.end_time),
        done: false,
        focusScore: null
      };
  const merged = sortReplaceBlocks([...existing, newBlock]);
  await replaceStudyBlocks(studentId, row.target_date, merged);
  await query(
    `UPDATE parent_plan_add_requests
     SET status = 'approved', resolved_at = now(), resolved_by_parent_user_id = $2
     WHERE id = $1`,
    [requestId, parentUserId]
  );
  return { ok: true };
}

async function rejectPlanAddRequestByParent(requestId, parentUserId) {
  const reqRow = await query(
    `SELECT * FROM parent_plan_add_requests WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  if (reqRow.rows.length === 0) {
    return { ok: false, error: "요청을 찾을 수 없거나 이미 처리되었습니다." };
  }
  const row = reqRow.rows[0];
  const has = await parentHasStudent(
    parentUserId,
    Number(row.student_user_id)
  );
  if (!has) {
    return { ok: false, error: "연결된 자녀의 요청만 처리할 수 있습니다." };
  }
  await query(
    `UPDATE parent_plan_add_requests
     SET status = 'rejected', resolved_at = now(), resolved_by_parent_user_id = $2
     WHERE id = $1`,
    [requestId, parentUserId]
  );
  return { ok: true };
}

async function countUnreadStudentNotifications(userId) {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS c
       FROM student_in_app_notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return Number(r.rows[0]?.c) || 0;
  } catch {
    return 0;
  }
}

async function listStudentNotifications(userId) {
  const r = await query(
    `SELECT id, title, body, read_at, created_at
     FROM student_in_app_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  return r.rows;
}

async function markStudentNotificationsReadAll(userId) {
  await query(
    `UPDATE student_in_app_notifications
     SET read_at = now()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
}

async function countUnreadParentNotifications(userId) {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS c
       FROM parent_in_app_notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return Number(r.rows[0]?.c) || 0;
  } catch {
    return 0;
  }
}

async function listParentNotifications(userId) {
  const r = await query(
    `SELECT id, title, body, read_at, created_at
     FROM parent_in_app_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  return r.rows;
}

async function markParentNotificationsReadAll(userId) {
  await query(
    `UPDATE parent_in_app_notifications
     SET read_at = now()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
}

async function createParentNotificationForLinkedParents(studentUserId, title, body) {
  const parentUserIds = await listLinkedParentUserIdsForStudent(studentUserId);
  if (!parentUserIds.length) return 0;
  for (const parentUserId of parentUserIds) {
    await query(
      `INSERT INTO parent_in_app_notifications (user_id, title, body)
       VALUES ($1, $2, $3)`,
      [parentUserId, String(title || ""), body != null ? String(body) : null]
    );
  }
  return parentUserIds.length;
}

module.exports = {
  pool,
  query,
  ensureConnected,
  findUserByEmail,
  createUser,
  getMe,
  getUserByIdForAuth,
  updateUserEmail,
  updateUserPasswordHash,
  deleteUser,
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
  upsertStudentCoachLog,
  setStudentCoachLogTomorrowPractice,
  setStudentCoachLogTomorrowPracticeDone,
  listRecentStudentCoachLogs,
  listStudentCoachLogsInWeekRange,
  insertStudentCoachMessage,
  listRecentStudentCoachMessages,
  countUnreadStudentNotifications,
  listStudentNotifications,
  markStudentNotificationsReadAll,
  countUnreadParentNotifications,
  listParentNotifications,
  markParentNotificationsReadAll,
  createParentNotificationForLinkedParents,
  upsertParentStudentStudyRoom,
  deleteParentStudentStudyRoom,
  listStudyRoomConfigurationsForStudent,
  recordStudentStudyRoomHeartbeat,
  listRecentStudyRoomVisitSessionsForStudent,
  listRecentStudyRoomVisitSessionsForParent,
  getOrCreateStudyDay,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData,
  getStudyPlansForDate,
  listStudentProfileSchedules,
  createStudentProfileSchedule,
  updateStudentProfileSchedule,
  cancelStudentProfileScheduleOccurrence,
  deleteStudentProfileSchedule,
  listStudyBooks,
  createStudyBook,
  softDeleteStudyBook,
  countLinkedParentsForStudent,
  getActiveStudyBookForStudent,
  createParentPlanAddRequest,
  listPendingPlanAddRequestsForParent,
  approvePlanAddRequestByParent,
  rejectPlanAddRequestByParent
};


