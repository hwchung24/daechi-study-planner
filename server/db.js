const path = require("path");
const crypto = require("crypto");
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
            scp.goal_university,
            scp.target_grade,
            scp.current_concern,
            scp.weakness,
            COALESCE(scp.mdm_applied, false) AS "mdmApplied",
                 COALESCE(scp.alarm_schedule_reminders, true) AS "scheduleReminders",
                 COALESCE(scp.alarm_parent_link_alerts, true) AS "parentLinkAlerts",
                 COALESCE(scp.alarm_study_room_alerts, true) AS "studyRoomAlerts",
                 COALESCE(scp.alarm_message_alerts, true) AS "messageAlerts",
                 COALESCE(scp.alarm_homework_alerts, true) AS "homeworkAlerts",
                 COALESCE(scp.wake_alarm_enabled, false) AS "wakeAlarmEnabled",
                 COALESCE(scp.wake_alarm_time, '06:30') AS "wakeAlarmTime",
            COALESCE(scp.initial_profile_completed, false) AS initial_profile_completed,
            par.phone AS "parentPhone"
     FROM users u
     LEFT JOIN student_coach_profiles scp ON scp.user_id = u.id
     LEFT JOIN parents par ON par.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function getStudentAlarmSettings(userId) {
  const res = await query(
    `SELECT COALESCE(alarm_schedule_reminders, true) AS "scheduleReminders",
            COALESCE(alarm_parent_link_alerts, true) AS "parentLinkAlerts",
            COALESCE(alarm_study_room_alerts, true) AS "studyRoomAlerts",
          COALESCE(alarm_message_alerts, true) AS "messageAlerts",
          COALESCE(alarm_homework_alerts, true) AS "homeworkAlerts",
            COALESCE(wake_alarm_enabled, false) AS "wakeAlarmEnabled",
            COALESCE(wake_alarm_time, '06:30') AS "wakeAlarmTime"
     FROM student_coach_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return (
    res.rows[0] || {
      scheduleReminders: true,
      parentLinkAlerts: true,
      studyRoomAlerts: true,
      messageAlerts: true,
      homeworkAlerts: true,
      wakeAlarmEnabled: false,
      wakeAlarmTime: "06:30"
    }
  );
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

async function getParentAlarmSettings(userId) {
  const res = await query(
    `SELECT notification_prefs
     FROM parents
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const raw = res.rows[0]?.notification_prefs || {};
  return {
    reportAlerts:
      raw.reportAlerts == null ? true : Boolean(raw.reportAlerts),
    studentLinkAlerts:
      raw.studentLinkAlerts == null ? true : Boolean(raw.studentLinkAlerts),
    studyRoomAlerts:
      raw.studyRoomAlerts == null ? true : Boolean(raw.studyRoomAlerts),
    messageAlerts:
      raw.messageAlerts == null ? true : Boolean(raw.messageAlerts),
    homeworkAlerts:
      raw.homeworkAlerts == null ? true : Boolean(raw.homeworkAlerts),
    requestAlerts:
      raw.requestAlerts == null ? true : Boolean(raw.requestAlerts)
  };
}

async function upsertParentAlarmSettings(userId, input = {}) {
  const normalized = {
    reportAlerts:
      input.reportAlerts == null ? true : Boolean(input.reportAlerts),
    studentLinkAlerts:
      input.studentLinkAlerts == null ? true : Boolean(input.studentLinkAlerts),
    studyRoomAlerts:
      input.studyRoomAlerts == null ? true : Boolean(input.studyRoomAlerts),
    messageAlerts:
      input.messageAlerts == null ? true : Boolean(input.messageAlerts),
    homeworkAlerts:
      input.homeworkAlerts == null ? true : Boolean(input.homeworkAlerts),
    requestAlerts:
      input.requestAlerts == null ? true : Boolean(input.requestAlerts)
  };
  const res = await query(
    `INSERT INTO parents (user_id, notification_prefs)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET notification_prefs = EXCLUDED.notification_prefs
     RETURNING notification_prefs`,
    [userId, JSON.stringify(normalized)]
  );
  return {
    reportAlerts:
      res.rows[0]?.notification_prefs?.reportAlerts == null
        ? true
        : Boolean(res.rows[0].notification_prefs.reportAlerts),
    studentLinkAlerts:
      res.rows[0]?.notification_prefs?.studentLinkAlerts == null
        ? true
        : Boolean(res.rows[0].notification_prefs.studentLinkAlerts),
    studyRoomAlerts:
      res.rows[0]?.notification_prefs?.studyRoomAlerts == null
        ? true
        : Boolean(res.rows[0].notification_prefs.studyRoomAlerts),
    messageAlerts:
      res.rows[0]?.notification_prefs?.messageAlerts == null
        ? true
        : Boolean(res.rows[0].notification_prefs.messageAlerts),
    homeworkAlerts:
      res.rows[0]?.notification_prefs?.homeworkAlerts == null
        ? true
        : Boolean(res.rows[0].notification_prefs.homeworkAlerts),
    requestAlerts:
      res.rows[0]?.notification_prefs?.requestAlerts == null
        ? true
        : Boolean(res.rows[0].notification_prefs.requestAlerts)
  };
}

async function listParentStudents(parentUserId) {
  const parent = await getParentIdByUserId(parentUserId);
  if (!parent) return [];
  const res = await query(
    `SELECT u.id,
            u.email,
            scp.name AS student_name,
            COALESCE(scp.mdm_applied, false) AS "mdmApplied",
            mdm_app.ui_surface_mode AS app_allowance_surface,
            CASE
              WHEN mdm_kiosk.locked_bundle_id IS NOT NULL
                   AND btrim(mdm_kiosk.locked_bundle_id::text) <> '' THEN true
              ELSE false
            END AS kiosk_active,
            pssr.name AS study_room_name,
            pssr.address AS study_room_address,
            pssr.latitude AS study_room_latitude,
            pssr.longitude AS study_room_longitude,
          pssr.radius_meters AS study_room_radius_meters,
            pssr.updated_at AS study_room_updated_at
     FROM parents_students ps
     JOIN users u ON u.id = ps.student_id
     LEFT JOIN student_coach_profiles scp ON scp.user_id = u.id
     LEFT JOIN student_mdm_app_allowance_profiles mdm_app
       ON mdm_app.user_id = u.id AND mdm_app.provider = 'simplemdm'
     LEFT JOIN student_mdm_kiosk_profiles mdm_kiosk
       ON mdm_kiosk.user_id = u.id AND mdm_kiosk.provider = 'simplemdm'
     LEFT JOIN parent_student_study_rooms pssr
       ON pssr.parent_user_id = $2 AND pssr.student_user_id = u.id
     WHERE ps.parent_id = $1
     ORDER BY u.email ASC`,
    [parent.id, parentUserId]
  );
  return res.rows.map(row => ({
    id: Number(row.id),
    email: String(row.email || ""),
    name: row.student_name != null ? String(row.student_name) : null,
    mdmApplied: Boolean(row.mdmApplied),
    appAllowanceSurface:
      row.app_allowance_surface != null && String(row.app_allowance_surface).trim() !== ""
        ? (() => {
            const raw = String(row.app_allowance_surface).trim().toLowerCase();
            return raw === "bulk_lock" ? "block" : raw;
          })()
        : null,
    kioskActive: Boolean(row.kiosk_active),
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

async function getParentStudentAppModeSchedule(parentUserId, studentUserId) {
  const res = await query(
    `SELECT slots, updated_at
     FROM parent_student_app_mode_schedules
     WHERE parent_user_id = $1 AND student_user_id = $2`,
    [parentUserId, studentUserId]
  );
  return res.rows[0] || null;
}

async function upsertParentStudentAppModeSchedule(parentUserId, studentUserId, slotsJson) {
  const res = await query(
    `INSERT INTO parent_student_app_mode_schedules (parent_user_id, student_user_id, slots, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (parent_user_id, student_user_id)
     DO UPDATE SET slots = EXCLUDED.slots, updated_at = now()
     RETURNING slots, updated_at`,
    [parentUserId, studentUserId, slotsJson]
  );
  return res.rows[0] || null;
}

/** 크론: 학부모가 저장한 모드 시간표가 있는 학생(빈 배열 포함, 행이 있는 경우만) */
async function listAllParentStudentAppModeScheduleRows() {
  const res = await query(
    `SELECT student_user_id, COALESCE(slots, '[]'::jsonb) AS slots
     FROM parent_student_app_mode_schedules`
  );
  return res.rows;
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

async function getLatestStudentLocation(studentUserId) {
  const res = await query(
    `SELECT student_user_id,
            latitude,
            longitude,
            accuracy,
            occurred_at,
            received_at,
            updated_at
     FROM student_last_known_locations
     WHERE student_user_id = $1`,
    [studentUserId]
  );
  return res.rows[0] || null;
}

async function upsertLatestStudentLocation(studentUserId, input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const accuracy =
    input.accuracy != null && Number.isFinite(Number(input.accuracy))
      ? Number(input.accuracy)
      : null;
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);

  const res = await query(
    `INSERT INTO student_last_known_locations
      (student_user_id, latitude, longitude, accuracy, occurred_at, received_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (student_user_id)
     DO UPDATE SET
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       accuracy = EXCLUDED.accuracy,
       occurred_at = EXCLUDED.occurred_at,
       received_at = now(),
       updated_at = now()
     WHERE student_last_known_locations.occurred_at IS NULL
        OR EXCLUDED.occurred_at >= student_last_known_locations.occurred_at
     RETURNING student_user_id,
               latitude,
               longitude,
               accuracy,
               occurred_at,
               received_at,
               updated_at`,
    [studentUserId, latitude, longitude, accuracy, occurredAt.toISOString()]
  );

  if (res.rows[0]) return res.rows[0];
  return getLatestStudentLocation(studentUserId);
}

async function listCurrentStudyRoomDistancesForStudent(studentUserId) {
  const [latestLocation, studyRooms] = await Promise.all([
    getLatestStudentLocation(studentUserId),
    listStudyRoomConfigurationsForStudent(studentUserId)
  ]);

  const lat =
    latestLocation?.latitude != null && Number.isFinite(Number(latestLocation.latitude))
      ? Number(latestLocation.latitude)
      : null;
  const lng =
    latestLocation?.longitude != null && Number.isFinite(Number(latestLocation.longitude))
      ? Number(latestLocation.longitude)
      : null;

  let currentHeartbeatAt = null;
  if (latestLocation) {
    const o = latestLocation.occurred_at
      ? new Date(latestLocation.occurred_at).getTime()
      : NaN;
    const r = latestLocation.received_at
      ? new Date(latestLocation.received_at).getTime()
      : NaN;
    const best = Math.max(
      Number.isFinite(o) ? o : 0,
      Number.isFinite(r) ? r : 0
    );
    currentHeartbeatAt = best > 0 ? new Date(best).toISOString() : null;
  }

  return {
    currentHeartbeatAt,
    currentAccuracyMeters:
      latestLocation?.accuracy != null && Number.isFinite(Number(latestLocation.accuracy))
        ? Number(latestLocation.accuracy)
        : null,
    currentLatitude: lat,
    currentLongitude: lng,
    rooms: studyRooms.map(row => {
      const radiusMeters =
        row.radius_meters != null && Number.isFinite(Number(row.radius_meters))
          ? Number(row.radius_meters)
          : 120;
      const currentDistanceMeters = latestLocation
        ? haversineMeters(
            Number(latestLocation.latitude),
            Number(latestLocation.longitude),
            Number(row.latitude),
            Number(row.longitude)
          )
        : null;
      return {
        id: Number(row.id),
        parentUserId: Number(row.parent_user_id),
        parentEmail: String(row.parent_email || "").trim(),
        name: String(row.name || "독서실").trim() || "독서실",
        address: row.address != null ? String(row.address) : null,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        radiusMeters,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        currentDistanceMeters,
        isWithinRadius: currentDistanceMeters == null ? null : currentDistanceMeters <= radiusMeters
      };
    })
  };
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
  let occurredAt = occurredAtRaw ? new Date(String(occurredAtRaw)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("invalid_timestamp");
  }
  const serverMs = Date.now();
  const clientMs = occurredAt.getTime();
  const driftMs = serverMs - clientMs;
  /** GPS/브라우저 캐시로 시각이 크게 밀리면 학부모 화면 기준 시각이 멈춘 것처럼 보임 → 서버 시각으로 보정 */
  if (driftMs > 3 * 60 * 1000 || driftMs < -120 * 1000) {
    occurredAt = new Date(serverMs);
  }
  await upsertLatestStudentLocation(studentUserId, {
    latitude,
    longitude,
    accuracy: input.accuracy,
    occurredAt
  });
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
  const transitions = [];
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
        transitions.push({
          type: "entered",
          parentUserId: Number(room.parent_user_id),
          studyRoomId: Number(room.id),
          studyRoomName: String(room.name || "독서실").trim() || "독서실",
          distanceMeters,
          occurredAt: occurredAt.toISOString()
        });
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
      transitions.push({
        type: "exited",
        parentUserId: Number(room.parent_user_id),
        studyRoomId: Number(room.id),
        studyRoomName: String(room.name || "독서실").trim() || "독서실",
        distanceMeters,
        occurredAt: occurredAt.toISOString()
      });
    }
  }
  return {
    studyRoomCount: studyRooms.length,
    nearbyStudyRoomCount: nearbyRooms.length,
    transitions
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

async function listLinkedParentPhonesForStudent(studentUserId) {
  const res = await query(
    `SELECT DISTINCT p.phone
     FROM parents_students ps
     JOIN parents p ON p.id = ps.parent_id
     WHERE ps.student_id = $1
       AND p.phone IS NOT NULL
       AND btrim(p.phone) <> ''`,
    [studentUserId]
  );
  return res.rows
    .map(row => String(row.phone || "").trim())
    .filter(phone => phone.length > 0);
}

function getParentSignupOtpSecret() {
  return String(
    process.env.PARENT_SIGNUP_OTP_SECRET || process.env.JWT_SECRET || "dev-parent-signup-otp"
  ).trim();
}

function hashParentSignupOtp(phoneNormalized, codePlain) {
  return crypto
    .createHmac("sha256", getParentSignupOtpSecret())
    .update(`${phoneNormalized}|${String(codePlain).trim()}`)
    .digest("hex");
}

async function getParentSignupPhoneOtpRow(phoneNormalized) {
  const res = await query(
    `SELECT code_hash, expires_at, attempt_count, last_sent_at
     FROM parent_signup_phone_otps
     WHERE phone_normalized = $1`,
    [phoneNormalized]
  );
  return res.rows[0] || null;
}

async function upsertParentSignupPhoneOtp(phoneNormalized, codePlain) {
  const codeHash = hashParentSignupOtp(phoneNormalized, codePlain);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await query(
    `INSERT INTO parent_signup_phone_otps (phone_normalized, code_hash, expires_at, attempt_count, last_sent_at)
     VALUES ($1, $2, $3, 0, now())
     ON CONFLICT (phone_normalized) DO UPDATE SET
       code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at,
       attempt_count = 0,
       last_sent_at = now()`,
    [phoneNormalized, codeHash, expiresAt]
  );
}

async function deleteParentSignupPhoneOtp(phoneNormalized) {
  await query(`DELETE FROM parent_signup_phone_otps WHERE phone_normalized = $1`, [
    phoneNormalized
  ]);
}

async function parentPhoneNormalizedExists(phoneNormalized) {
  const res = await query(
    `SELECT 1 FROM parents p
     WHERE p.phone IS NOT NULL
       AND regexp_replace(p.phone, '[^0-9]', '', 'g') = $1
     LIMIT 1`,
    [phoneNormalized]
  );
  return res.rows.length > 0;
}

/** 동일 번호를 다른 학부모 계정이 쓰는지 (본인 user_id 제외) */
async function parentPhoneNormalizedTakenByOtherParent(
  phoneNormalized,
  excludeUserId
) {
  const res = await query(
    `SELECT 1 FROM parents p
     WHERE p.user_id <> $2
       AND p.phone IS NOT NULL
       AND regexp_replace(p.phone, '[^0-9]', '', 'g') = $1
     LIMIT 1`,
    [phoneNormalized, excludeUserId]
  );
  return res.rows.length > 0;
}

async function verifyParentSignupPhoneOtp(phoneNormalized, codePlain) {
  const row = await getParentSignupPhoneOtpRow(phoneNormalized);
  if (!row) {
    return { ok: false, error: "인증번호를 먼저 요청해 주세요." };
  }
  if (Number(row.attempt_count) >= 10) {
    return { ok: false, error: "인증 시도 횟수를 초과했어요. 잠시 후 다시 요청해 주세요." };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, error: "인증 시간이 지났어요. 인증번호를 다시 요청해 주세요." };
  }
  const actual = hashParentSignupOtp(phoneNormalized, codePlain);
  const expectedBuf = Buffer.from(String(row.code_hash), "hex");
  const actualBuf = Buffer.from(actual, "hex");
  if (
    expectedBuf.length !== actualBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, actualBuf)
  ) {
    await query(
      `UPDATE parent_signup_phone_otps SET attempt_count = attempt_count + 1 WHERE phone_normalized = $1`,
      [phoneNormalized]
    );
    return { ok: false, error: "인증번호가 올바르지 않아요." };
  }
  await deleteParentSignupPhoneOtp(phoneNormalized);
  return { ok: true };
}

async function assertParentSignupPhoneResendCooldown(phoneNormalized, minIntervalMs) {
  const row = await getParentSignupPhoneOtpRow(phoneNormalized);
  if (!row) return { ok: true };
  const last = new Date(row.last_sent_at).getTime();
  if (Date.now() - last < minIntervalMs) {
    return { ok: false, error: "잠시 후 다시 요청해 주세요." };
  }
  return { ok: true };
}

async function setParentPhoneForUser(userId, phoneNormalized) {
  await query(
    `INSERT INTO parents (user_id, phone)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET phone = EXCLUDED.phone`,
    [userId, phoneNormalized]
  );
}

async function getParentPhoneByUserId(userId) {
  const res = await query(
    `SELECT p.phone FROM parents p WHERE p.user_id = $1 LIMIT 1`,
    [userId]
  );
  const raw = res.rows[0]?.phone;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

async function getParentCoachCustomization(parentUserId) {
  const res = await query(
    `SELECT *
     FROM parent_coach_customizations
     WHERE parent_user_id = $1
     LIMIT 1`,
    [parentUserId]
  );
  return res.rows[0] || null;
}

async function upsertParentCoachCustomization(parentUserId, input = {}) {
  const res = await query(
    `INSERT INTO parent_coach_customizations
      (parent_user_id, persona, tone, control_intensity, focus_rules, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (parent_user_id)
     DO UPDATE SET
       persona = EXCLUDED.persona,
       tone = EXCLUDED.tone,
       control_intensity = EXCLUDED.control_intensity,
       focus_rules = EXCLUDED.focus_rules,
       updated_at = now()
     RETURNING *`,
    [
      parentUserId,
      String(input.persona || "").trim(),
      String(input.tone || "").trim(),
      Number(input.controlIntensity),
      String(input.focusRules || "").trim()
    ]
  );
  return res.rows[0] || null;
}

async function getEffectiveParentCoachCustomizationForStudent(studentUserId) {
  const res = await query(
    `SELECT pcc.*, pu.email AS parent_email
     FROM parent_coach_customizations pcc
     JOIN parents p ON p.user_id = pcc.parent_user_id
     JOIN parents_students ps ON ps.parent_id = p.id
     JOIN users pu ON pu.id = pcc.parent_user_id
     WHERE ps.student_id = $1
     ORDER BY pcc.updated_at DESC, pcc.parent_user_id ASC
     LIMIT 1`,
    [studentUserId]
  );
  return res.rows[0] || null;
}

async function insertParentsStudentsRow(parentDbId, studentUserId) {
  await query(
    `INSERT INTO parents_students (parent_id, student_id)
     VALUES ($1, $2)
     ON CONFLICT (parent_id, student_id) DO NOTHING`,
    [parentDbId, studentUserId]
  );
}

async function withStudentLinkLock(studentUserId, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [Number(studentUserId)]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getParentIdByUserIdWithClient(client, parentUserId) {
  const res = await client.query("SELECT id FROM parents WHERE user_id = $1", [parentUserId]);
  return res.rows[0] || null;
}

async function findLinkedParentForStudentWithClient(client, studentUserId) {
  const res = await client.query(
    `SELECT ps.parent_id, p.user_id, u.email
     FROM parents_students ps
     JOIN parents p ON p.id = ps.parent_id
     JOIN users u ON u.id = p.user_id
     WHERE ps.student_id = $1
     ORDER BY u.email ASC
     LIMIT 1`,
    [studentUserId]
  );
  return res.rows[0] || null;
}

async function findPendingLinkRequestForStudentWithClient(client, studentUserId) {
  const res = await client.query(
    `SELECT r.id, r.parent_user_id, u.email AS parent_email
     FROM parent_student_link_requests r
     JOIN users u ON u.id = r.parent_user_id
     WHERE r.student_user_id = $1 AND r.status = 'pending'
     ORDER BY r.created_at ASC
     LIMIT 1`,
    [studentUserId]
  );
  return res.rows[0] || null;
}

async function insertParentsStudentsRowWithClient(client, parentDbId, studentUserId) {
  await client.query(
    `INSERT INTO parents_students (parent_id, student_id)
     VALUES ($1, $2)
     ON CONFLICT (parent_id, student_id) DO NOTHING`,
    [parentDbId, studentUserId]
  );
}

async function rejectOtherPendingLinkRequestsForStudentWithClient(
  client,
  studentUserId,
  activeRequestId
) {
  await client.query(
    `UPDATE parent_student_link_requests
     SET status = 'rejected', updated_at = now()
     WHERE student_user_id = $1 AND status = 'pending' AND id <> $2`,
    [studentUserId, activeRequestId]
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
  return withStudentLinkLock(student.id, async client => {
    const linked = await findLinkedParentForStudentWithClient(client, student.id);
    if (linked) {
      if (Number(linked.user_id) === Number(parentUserId)) {
        return { ok: false, error: "이미 연결된 학생입니다." };
      }
      return { ok: false, error: "이 학생은 이미 다른 학부모와 연결되어 있습니다." };
    }
    const pending = await findPendingLinkRequestForStudentWithClient(client, student.id);
    if (pending) {
      if (Number(pending.parent_user_id) === Number(parentUserId)) {
        return { ok: false, error: "이미 진행 중인 연결 요청이 있습니다." };
      }
      return { ok: false, error: "이 학생은 이미 다른 학부모와 연결 요청을 진행 중입니다." };
    }
    const ins = await client.query(
      `INSERT INTO parent_student_link_requests
       (parent_user_id, student_user_id, initiated_by, parent_confirmed_at, student_confirmed_at, status)
       VALUES ($1, $2, 'parent', now(), NULL, 'pending')
       RETURNING id`,
      [parentUserId, student.id]
    );
    return {
      ok: true,
      requestId: ins.rows[0].id,
      studentUserId: Number(student.id)
    };
  });
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
  return withStudentLinkLock(studentUserId, async client => {
    const linked = await findLinkedParentForStudentWithClient(client, studentUserId);
    if (linked) {
      if (Number(linked.user_id) === Number(parentUser.id)) {
        return { ok: false, error: "이미 연결된 학부모입니다." };
      }
      return { ok: false, error: "이미 연결된 학부모가 있습니다." };
    }
    const pending = await findPendingLinkRequestForStudentWithClient(client, studentUserId);
    if (pending) {
      if (Number(pending.parent_user_id) === Number(parentUser.id)) {
        return { ok: false, error: "이미 진행 중인 연결 요청이 있습니다." };
      }
      return { ok: false, error: "이미 다른 학부모와 연결 요청을 진행 중입니다." };
    }
    const ins = await client.query(
      `INSERT INTO parent_student_link_requests
       (parent_user_id, student_user_id, initiated_by, parent_confirmed_at, student_confirmed_at, status)
       VALUES ($1, $2, 'student', NULL, now(), 'pending')
       RETURNING id`,
      [parentUser.id, studentUserId]
    );
    return {
      ok: true,
      requestId: ins.rows[0].id,
      parentUserId: Number(parentUser.id),
      studentUserId: Number(studentUserId)
    };
  });
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
  return withStudentLinkLock(studentUserId, async client => {
    const req = await client.query(
      `SELECT * FROM parent_student_link_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
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
    const linked = await findLinkedParentForStudentWithClient(client, studentUserId);
    if (linked && Number(linked.user_id) !== Number(row.parent_user_id)) {
      return { ok: false, error: "이미 다른 학부모와 연결되어 있습니다." };
    }
    const parent = await getParentIdByUserIdWithClient(client, row.parent_user_id);
    if (!parent) return { ok: false, error: "학부모 정보를 찾을 수 없습니다." };
    await client.query(
      `UPDATE parent_student_link_requests
       SET student_confirmed_at = now(), status = 'active', updated_at = now()
       WHERE id = $1`,
      [requestId]
    );
    await insertParentsStudentsRowWithClient(client, parent.id, row.student_user_id);
    await rejectOtherPendingLinkRequestsForStudentWithClient(
      client,
      row.student_user_id,
      requestId
    );
    return {
      ok: true,
      parentUserId: Number(row.parent_user_id),
      studentUserId: Number(row.student_user_id)
    };
  });
}

async function parentConfirmLinkRequest(parentUserId, requestId) {
  const req = await query(
    `SELECT student_user_id FROM parent_student_link_requests WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  const studentUserId = Number(req.rows[0]?.student_user_id || 0);
  if (!studentUserId) {
    return { ok: false, error: "요청을 찾을 수 없습니다." };
  }
  return withStudentLinkLock(studentUserId, async client => {
    const pending = await client.query(
      `SELECT * FROM parent_student_link_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [requestId]
    );
    const row = pending.rows[0];
    if (!row) return { ok: false, error: "요청을 찾을 수 없습니다." };
    if (Number(row.parent_user_id) !== Number(parentUserId)) {
      return { ok: false, error: "권한이 없습니다." };
    }
    if (row.initiated_by !== "student" || !row.student_confirmed_at || row.parent_confirmed_at) {
      return { ok: false, error: "승인할 수 없는 요청입니다." };
    }
    const linked = await findLinkedParentForStudentWithClient(client, row.student_user_id);
    if (linked && Number(linked.user_id) !== Number(parentUserId)) {
      return { ok: false, error: "이 학생은 이미 다른 학부모와 연결되어 있습니다." };
    }
    const parent = await getParentIdByUserIdWithClient(client, parentUserId);
    if (!parent) return { ok: false, error: "학부모 정보를 찾을 수 없습니다." };
    await client.query(
      `UPDATE parent_student_link_requests
       SET parent_confirmed_at = now(), status = 'active', updated_at = now()
       WHERE id = $1`,
      [requestId]
    );
    await insertParentsStudentsRowWithClient(client, parent.id, row.student_user_id);
    await rejectOtherPendingLinkRequestsForStudentWithClient(
      client,
      row.student_user_id,
      requestId
    );
    return {
      ok: true,
      parentUserId: Number(row.parent_user_id),
      studentUserId: Number(row.student_user_id)
    };
  });
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
  return {
    ok: true,
    parentUserId: Number(row.parent_user_id),
    studentUserId: Number(row.student_user_id),
    initiatedBy: String(row.initiated_by || "")
  };
}

async function unlinkParentStudentWithClient(client, parentUserId, studentUserId) {
  const parent = await getParentIdByUserIdWithClient(client, parentUserId);
  if (!parent) {
    return { ok: false, error: "학부모 정보를 찾을 수 없습니다." };
  }

  const linked = await client.query(
    `SELECT 1
     FROM parents_students
     WHERE parent_id = $1 AND student_id = $2
     FOR UPDATE`,
    [parent.id, studentUserId]
  );
  if (linked.rows.length === 0) {
    return { ok: false, error: "이미 연결이 해제되었습니다." };
  }

  await client.query(
    `DELETE FROM parent_planner_rules
     WHERE parent_user_id = $1 AND student_user_id = $2`,
    [parentUserId, studentUserId]
  );
  await client.query(
    `DELETE FROM parent_student_study_rooms
     WHERE parent_user_id = $1 AND student_user_id = $2`,
    [parentUserId, studentUserId]
  );
  await client.query(
    `DELETE FROM parents_students
     WHERE parent_id = $1 AND student_id = $2`,
    [parent.id, studentUserId]
  );
  return { ok: true };
}

async function createUnlinkRequest({ actorUserId, actorRole, parentUserId, studentUserId }) {
  if (actorRole !== "parent" && actorRole !== "student") {
    return { ok: false, error: "권한이 없습니다." };
  }
  if (!Number.isFinite(Number(parentUserId)) || !Number.isFinite(Number(studentUserId))) {
    return { ok: false, error: "연결 정보를 확인해 주세요." };
  }

  return withStudentLinkLock(studentUserId, async client => {
    if (actorRole === "parent" && Number(actorUserId) !== Number(parentUserId)) {
      return { ok: false, error: "권한이 없습니다." };
    }
    if (actorRole === "student" && Number(actorUserId) !== Number(studentUserId)) {
      return { ok: false, error: "권한이 없습니다." };
    }

    const parent = await getParentIdByUserIdWithClient(client, parentUserId);
    if (!parent) {
      return { ok: false, error: "학부모 정보를 찾을 수 없습니다." };
    }

    const linked = await client.query(
      `SELECT 1
       FROM parents_students
       WHERE parent_id = $1 AND student_id = $2
       FOR UPDATE`,
      [parent.id, studentUserId]
    );
    if (linked.rows.length === 0) {
      return { ok: false, error: "연결된 계정이 없습니다." };
    }

    const pending = await client.query(
      `SELECT id, initiated_by
       FROM parent_student_unlink_requests
       WHERE parent_user_id = $1 AND student_user_id = $2 AND status = 'pending'
       LIMIT 1`,
      [parentUserId, studentUserId]
    );
    if (pending.rows[0]) {
      return {
        ok: false,
        error:
          pending.rows[0].initiated_by === actorRole
            ? "이미 보낸 연결 끊기 요청이 있습니다."
            : "상대 확인을 기다리는 연결 끊기 요청이 있습니다."
      };
    }

    const ins = await client.query(
      `INSERT INTO parent_student_unlink_requests
       (parent_user_id, student_user_id, initiated_by, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [parentUserId, studentUserId, actorRole]
    );
    return { ok: true, requestId: Number(ins.rows[0]?.id || 0) };
  });
}

async function confirmUnlinkRequest({ actorUserId, actorRole, requestId }) {
  const req = await query(
    `SELECT student_user_id
     FROM parent_student_unlink_requests
     WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  const studentUserId = Number(req.rows[0]?.student_user_id || 0);
  if (!studentUserId) {
    return { ok: false, error: "요청을 찾을 수 없습니다." };
  }

  return withStudentLinkLock(studentUserId, async client => {
    const pending = await client.query(
      `SELECT *
       FROM parent_student_unlink_requests
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [requestId]
    );
    const row = pending.rows[0];
    if (!row) {
      return { ok: false, error: "요청을 찾을 수 없습니다." };
    }
    const actorIsRecipient =
      (row.initiated_by === "parent" && actorRole === "student" && Number(row.student_user_id) === Number(actorUserId)) ||
      (row.initiated_by === "student" && actorRole === "parent" && Number(row.parent_user_id) === Number(actorUserId));
    if (!actorIsRecipient) {
      return { ok: false, error: "권한이 없습니다." };
    }

    const unlinkResult = await unlinkParentStudentWithClient(
      client,
      Number(row.parent_user_id),
      Number(row.student_user_id)
    );
    if (!unlinkResult.ok) {
      return unlinkResult;
    }

    await client.query(
      `UPDATE parent_student_unlink_requests
       SET status = 'approved', resolved_at = now(), resolved_by_user_id = $2
       WHERE id = $1`,
      [requestId, actorUserId]
    );
    return {
      ok: true,
      parentUserId: Number(row.parent_user_id),
      studentUserId: Number(row.student_user_id),
      initiatedBy: String(row.initiated_by || "")
    };
  });
}

async function rejectUnlinkRequest({ actorUserId, actorRole, requestId }) {
  const req = await query(
    `SELECT student_user_id
     FROM parent_student_unlink_requests
     WHERE id = $1 AND status = 'pending'`,
    [requestId]
  );
  const studentUserId = Number(req.rows[0]?.student_user_id || 0);
  if (!studentUserId) {
    return { ok: false, error: "요청을 찾을 수 없습니다." };
  }
  return withStudentLinkLock(studentUserId, async client => {
    const pending = await client.query(
      `SELECT *
       FROM parent_student_unlink_requests
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [requestId]
    );
    const row = pending.rows[0];
    if (!row) {
      return { ok: false, error: "요청을 찾을 수 없습니다." };
    }
    const actorIsRecipient =
      (row.initiated_by === "parent" && actorRole === "student" && Number(row.student_user_id) === Number(actorUserId)) ||
      (row.initiated_by === "student" && actorRole === "parent" && Number(row.parent_user_id) === Number(actorUserId));
    if (!actorIsRecipient) {
      return { ok: false, error: "권한이 없습니다." };
    }
    await client.query(
      `UPDATE parent_student_unlink_requests
       SET status = 'rejected', resolved_at = now(), resolved_by_user_id = $2
       WHERE id = $1`,
      [requestId, actorUserId]
    );
    return {
      ok: true,
      parentUserId: Number(row.parent_user_id),
      studentUserId: Number(row.student_user_id),
      initiatedBy: String(row.initiated_by || "")
    };
  });
}

async function unlinkParentStudent({ actorUserId, actorRole, parentUserId, studentUserId }) {
  if (actorRole !== "parent" && actorRole !== "student") {
    return { ok: false, error: "권한이 없습니다." };
  }
  if (!Number.isFinite(Number(parentUserId)) || !Number.isFinite(Number(studentUserId))) {
    return { ok: false, error: "연결 정보를 확인해 주세요." };
  }

  return withStudentLinkLock(studentUserId, async client => {
    if (actorRole === "parent" && Number(actorUserId) !== Number(parentUserId)) {
      return { ok: false, error: "권한이 없습니다." };
    }
    if (actorRole === "student" && Number(actorUserId) !== Number(studentUserId)) {
      return { ok: false, error: "권한이 없습니다." };
    }
    return unlinkParentStudentWithClient(client, parentUserId, studentUserId);
  });
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

const WEEKLY_APP_ALLOWANCE_DAY_KEYS = new Set([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun"
]);

const DAECHI_ROOT_WEEKLY_APP = {
  id: "com.daechiroot.ios",
  name: "대치루트",
  category: "필수 앱",
  description: "대치루트 앱은 항상 허용됩니다.",
  bundleId: "com.daechiroot.ios"
};

function normalizeWeeklyAllowanceTime(value, options = {}) {
  const trimmed = String(value || "").trim().slice(0, 5);
  if (options.allow24 && trimmed === "24:00") return trimmed;
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function weeklyAllowanceTimeToMinutes(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "24:00") return 24 * 60;
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isDaechiRootWeeklyApp(app) {
  const id = String(app?.id || "").trim().toLowerCase();
  const bundleId = String(app?.bundleId || "").trim().toLowerCase();
  const name = String(app?.name || "").trim();
  return id === "com.daechiroot.ios" || bundleId === "com.daechiroot.ios" || name === "대치루트";
}

function normalizeWeeklyAllowanceApps(rows) {
  const seen = new Set();
  const items = (Array.isArray(rows) ? rows : [])
    .map(app => ({
      id: String(app?.id || app?.app_key || app?.bundleId || "").trim().slice(0, 200),
      name: String(app?.name || "").trim().slice(0, 120),
      category: String(app?.category || "").trim().slice(0, 80) || "기기 앱",
      description:
        app?.description != null && String(app.description).trim() !== ""
          ? String(app.description).trim().slice(0, 300)
          : null,
      bundleId:
        app?.bundleId != null && String(app.bundleId).trim() !== ""
          ? String(app.bundleId).trim().slice(0, 200)
          : null
    }))
    .filter(app => {
      if (!app.id || !app.name) return false;
      const key = `${app.id}::${app.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!items.some(isDaechiRootWeeklyApp)) {
    items.unshift({ ...DAECHI_ROOT_WEEKLY_APP });
  }
  const root = items.find(isDaechiRootWeeklyApp) || { ...DAECHI_ROOT_WEEKLY_APP };
  const others = items.filter(app => !isDaechiRootWeeklyApp(app));
  return [root, ...others];
}

function normalizeWeeklyAppAllowanceSlotInput(input) {
  const weekdayKey = String(input?.dayKey || input?.weekdayKey || "")
    .trim()
    .toLowerCase();
  const startTime = normalizeWeeklyAllowanceTime(input?.startTime, { allow24: false });
  const endTime = normalizeWeeklyAllowanceTime(input?.endTime, { allow24: true });
  if (!WEEKLY_APP_ALLOWANCE_DAY_KEYS.has(weekdayKey)) return null;
  if (!startTime || !endTime) return null;
  const startMinutes = weeklyAllowanceTimeToMinutes(startTime);
  const endMinutes = weeklyAllowanceTimeToMinutes(endTime);
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  return {
    weekdayKey,
    startTime,
    endTime,
    allowedApps: normalizeWeeklyAllowanceApps(input?.allowedApps)
  };
}

function sortWeeklyAppAllowanceSlotRows(rows) {
  return [...rows].sort((left, right) => {
    const leftStart = weeklyAllowanceTimeToMinutes(left.startTime);
    const rightStart = weeklyAllowanceTimeToMinutes(right.startTime);
    if (leftStart !== rightStart) {
      return (leftStart ?? Number.MAX_SAFE_INTEGER) - (rightStart ?? Number.MAX_SAFE_INTEGER);
    }
    const leftEnd = weeklyAllowanceTimeToMinutes(left.endTime);
    const rightEnd = weeklyAllowanceTimeToMinutes(right.endTime);
    return (leftEnd ?? Number.MAX_SAFE_INTEGER) - (rightEnd ?? Number.MAX_SAFE_INTEGER);
  });
}

function validateWeeklyAppAllowanceSlots(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.weekdayKey;
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  for (const [, bucket] of grouped) {
    const sorted = sortWeeklyAppAllowanceSlotRows(bucket);
    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = weeklyAllowanceTimeToMinutes(sorted[index - 1].endTime);
      const currentStart = weeklyAllowanceTimeToMinutes(sorted[index].startTime);
      if (previousEnd != null && currentStart != null && currentStart < previousEnd) {
        return false;
      }
    }
  }
  return true;
}

async function listStudentWeeklyAppAllowanceSlots(userId) {
  const res = await query(
    `SELECT id, weekday_key, start_time, end_time, allowed_apps, created_at, updated_at
     FROM student_weekly_app_allowance_slots
     WHERE user_id = $1
     ORDER BY weekday_key ASC, start_time ASC, created_at ASC`,
    [userId]
  );
  return res.rows.map(row => ({
    ...row,
    allowed_apps: normalizeWeeklyAllowanceApps(row.allowed_apps)
  }));
}

async function replaceStudentWeeklyAppAllowanceSlots(userId, slots) {
  const normalized = (Array.isArray(slots) ? slots : [])
    .map(normalizeWeeklyAppAllowanceSlotInput)
    .filter(Boolean);
  if (!validateWeeklyAppAllowanceSlots(normalized)) {
    throw new Error("WEEKLY_APP_ALLOWANCE_OVERLAP");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM student_weekly_app_allowance_slots WHERE user_id = $1`,
      [userId]
    );
    for (const slot of normalized) {
      await client.query(
        `INSERT INTO student_weekly_app_allowance_slots
         (user_id, weekday_key, start_time, end_time, allowed_apps)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          userId,
          slot.weekdayKey,
          slot.startTime,
          slot.endTime,
          JSON.stringify(slot.allowedApps)
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return listStudentWeeklyAppAllowanceSlots(userId);
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

    const deactivated = await client.query(
      `UPDATE user_device_links
       SET is_active = false,
           unlinked_at = now(),
           unlink_reason = 'reassigned'
       WHERE serial_number = $1
         AND is_active = true
         AND user_id <> $2
       RETURNING user_id`,
      [serial, userId]
    );

    if (deactivated.rows.length) {
      await client.query(
        `UPDATE student_coach_profiles scp
         SET mdm_applied = false
         WHERE scp.user_id IN (
           SELECT DISTINCT d.user_id
           FROM (SELECT unnest($1::bigint[]) AS user_id) d
           JOIN users u
             ON u.id = d.user_id
            AND u.role = 'student'
           LEFT JOIN user_device_links udl
             ON udl.user_id = d.user_id
            AND udl.is_active = true
           WHERE udl.user_id IS NULL
         )`,
        [deactivated.rows.map((row) => row.user_id)]
      );
    }

    await client.query(
      `INSERT INTO user_device_links (user_id, serial_number, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, serial_number, is_active)
       DO NOTHING`,
      [userId, serial]
    );

    await client.query(
      `INSERT INTO student_coach_profiles (user_id, mdm_applied)
       SELECT id, true
       FROM users
       WHERE id = $1
         AND role = 'student'
       ON CONFLICT (user_id)
       DO UPDATE SET mdm_applied = true`,
      [userId]
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

function storeAppListingUrl(appStoreId, searchName) {
  const id = Number(appStoreId);
  if (Number.isFinite(id) && id > 0) {
    return `https://apps.apple.com/kr/app/id${Math.trunc(id)}`;
  }
  return `https://apps.apple.com/kr/search?term=${encodeURIComponent(
    String(searchName || "").trim() || "app"
  )}`;
}

/** 학습 스토어 기본 카탈로그(번들 ID 기준). 서버 기동 시 DB에 시드·동기화됩니다. */
const defaultStoreApps = [
  {
    appKey: "naver-map",
    name: "NAVER 지도",
    category: "지도",
    description: "내비게이션·길찾기·대중교통 정보를 제공하는 네이버 지도입니다.",
    url: storeAppListingUrl(311867728, "NAVER 지도"),
    bundleId: "com.nhncorp.NaverMap",
    appStoreId: 311867728,
    simplemdmAppId: null,
    sortOrder: 1
  },
  {
    appKey: "pass-skt",
    name: "PASS by SKT",
    category: "인증",
    description: "SKT 고객용 본인·금융 인증 및 모바일 신분증 서비스입니다.",
    url: storeAppListingUrl(1141258007, "PASS by SKT"),
    bundleId: "com.sktelecom.tauth",
    appStoreId: 1141258007,
    simplemdmAppId: null,
    sortOrder: 2
  },
  {
    appKey: "pass-uplus",
    name: "PASS by U+",
    category: "인증",
    description: "LG U+ 고객용 본인·금융 인증 및 모바일 신분증 서비스입니다.",
    url: storeAppListingUrl(1147394645, "PASS by U+"),
    bundleId: "com.lguplus.auth.ios",
    appStoreId: 1147394645,
    simplemdmAppId: null,
    sortOrder: 3
  },
  {
    appKey: "pass-kt",
    name: "PASS by KT",
    category: "인증",
    description: "KT 고객용 본인·금융 인증 및 모바일 신분증 서비스입니다.",
    url: storeAppListingUrl(1134371550, "PASS by KT"),
    bundleId: "com.kt.ktauth",
    appStoreId: 1134371550,
    simplemdmAppId: null,
    sortOrder: 4
  },
  {
    appKey: "mma-narasarang",
    name: "병무청",
    category: "공공",
    description: "병역·입영 등 병무 관련 정보와 모바일 증명 서비스를 제공합니다.",
    url: storeAppListingUrl(496516776, "병무청"),
    bundleId: "kr.go.mma.iphone.NarasarangApp",
    appStoreId: 496516776,
    simplemdmAppId: null,
    sortOrder: 5
  },
  {
    appKey: "kakao-t",
    name: "카카오 T",
    category: "모빌리티",
    description: "택시·대리·주차·바이크 등 이동과 생활 서비스를 한곳에서 이용합니다.",
    url: storeAppListingUrl(981110422, "카카오 T"),
    bundleId: "com.kakao.taxi",
    appStoreId: 981110422,
    simplemdmAppId: null,
    sortOrder: 6
  },
  {
    appKey: "toss",
    name: "토스",
    category: "금융",
    description: "송금·결제·자산 관리 등 금융 서비스를 제공합니다.",
    url: storeAppListingUrl(839333328, "토스"),
    bundleId: "com.vivarepublica.cash",
    appStoreId: 839333328,
    simplemdmAppId: null,
    sortOrder: 7
  },
  {
    appKey: "kakaotalk",
    name: "카카오톡",
    category: "소통",
    description: "메시지·통화·일정 공유 등 메신저 서비스입니다.",
    url: storeAppListingUrl(362057947, "카카오톡"),
    bundleId: "com.iwilab.KakaoTalk",
    appStoreId: 362057947,
    simplemdmAppId: null,
    sortOrder: 8
  },
  {
    appKey: "megastudy-smartplayer",
    name: "메가스터디 스마트러닝",
    category: "학습",
    description: "메가스터디 인강 수강·다운로드·배속 재생 등 학습 플레이어입니다.",
    url: storeAppListingUrl(670116327, "메가스터디 스마트러닝"),
    bundleId: "com.megastudy.SmartPlayer",
    appStoreId: 670116327,
    simplemdmAppId: null,
    sortOrder: 9
  },
  {
    appKey: "vflat-scan",
    name: "vFlat Scan",
    category: "도구",
    description: "문서·책을 스캔해 PDF로 저장하는 스캐너 앱입니다.",
    url: storeAppListingUrl(1540238220, "vFlat Scan"),
    bundleId: "com.voyagerx.scanner",
    appStoreId: 1540238220,
    simplemdmAppId: null,
    sortOrder: 10
  },
  {
    appKey: "etoos-smart-study",
    name: "이투스 스마트스터디",
    category: "학습",
    description: "이투스 인강 수강·다운로드·Q&A 등 수험 학습 앱입니다.",
    url: storeAppListingUrl(1486564159, "이투스 스마트스터디"),
    bundleId: "com.etoos.etoosstudyapp",
    appStoreId: 1486564159,
    simplemdmAppId: null,
    sortOrder: 11
  },
  {
    appKey: "orbi-class",
    name: "오르비 클래스",
    category: "학습",
    description: "오르비 인강 수강·진도·다운로드 등 클래스 전용 앱입니다.",
    url: storeAppListingUrl(null, "오르비 클래스"),
    bundleId: "com.move.orbi.class",
    appStoreId: null,
    simplemdmAppId: null,
    sortOrder: 12
  },
  {
    appKey: "megastudy-qube",
    name: "메가스터디 QUBE",
    category: "학습",
    description: "사진·텍스트로 질문하면 실시간 답변을 받는 문제 풀이 앱입니다.",
    url: storeAppListingUrl(1377555791, "메가스터디 QUBE"),
    bundleId: "net.megastudy.qube",
    appStoreId: 1377555791,
    simplemdmAppId: null,
    sortOrder: 13
  },
  {
    appKey: "qanda",
    name: "콴다",
    category: "학습",
    description: "문제 사진 업로드·실시간 질답 등 학습 Q&A 서비스입니다.",
    url: storeAppListingUrl(1270676408, "콴다"),
    bundleId: "Mathpresso.QandaStudent",
    appStoreId: 1270676408,
    simplemdmAppId: null,
    sortOrder: 14
  },
  {
    appKey: "naver-dictionary",
    name: "네이버 사전",
    category: "학습",
    description: "국어·영어 등 사전 검색과 발음·예문 학습을 제공합니다.",
    url: storeAppListingUrl(673085116, "네이버 사전"),
    bundleId: "com.nhncorp.naverdicapp",
    appStoreId: 673085116,
    simplemdmAppId: null,
    sortOrder: 15
  },
  {
    appKey: "hiclass",
    name: "하이클래스",
    category: "학교",
    description: "학급 알림·소통·학사 정보를 다루는 학교 연동 앱입니다.",
    url: storeAppListingUrl(1472488819, "하이클래스"),
    bundleId: "com.iscreammedia.app.hiclass.ios",
    appStoreId: 1472488819,
    simplemdmAppId: null,
    sortOrder: 16
  },
  {
    appKey: "athenaslab-todayschool",
    name: "오늘학교",
    category: "학습",
    description: "시간표·급식·학사 일정·학원 정보 등 학교 생활 도우미입니다.",
    url: storeAppListingUrl(1529825567, "오늘학교"),
    bundleId: "com.athenaslab.academy",
    appStoreId: 1529825567,
    simplemdmAppId: null,
    sortOrder: 17
  },
  {
    appKey: "goodnotes",
    name: "Goodnotes",
    category: "노트",
    description: "필기·PDF·문서 편집과 동기화를 지원하는 노트 앱입니다.",
    url: storeAppListingUrl(1444383602, "Goodnotes"),
    bundleId: "com.goodnotesapp.x",
    appStoreId: 1444383602,
    simplemdmAppId: null,
    sortOrder: 18
  }
];

async function ensureDefaultStoreApps() {
  if (ensureDefaultStoreApps._seeded) return;
  const catalogKeys = defaultStoreApps.map(a => a.appKey);
  await query(
    `UPDATE store_apps
     SET is_active = false, updated_at = now()
     WHERE NOT (app_key = ANY($1::text[]))`,
    [catalogKeys]
  );
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
         bundle_id = EXCLUDED.bundle_id,
         app_store_id = EXCLUDED.app_store_id,
         simplemdm_app_id = COALESCE(store_apps.simplemdm_app_id, EXCLUDED.simplemdm_app_id),
         sort_order = EXCLUDED.sort_order,
         is_active = true,
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

async function getStudentMdmAppAllowanceProfileState(userId) {
  const res = await query(
    `SELECT profile_id,
            profile_name,
            profile_identifier,
            override_bundle_ids,
            override_updated_at,
            ui_surface_mode,
            last_payload_hash,
            last_synced_at,
            last_error,
            updated_at
     FROM student_mdm_app_allowance_profiles
     WHERE user_id = $1
       AND provider = 'simplemdm'
     LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
}

/** 허용앱 표면 모드 스냅샷 — 부모 UI·device-control-state와 동기화 */
async function upsertStudentMdmAppAllowanceUiSurfaceMode(userId, surfaceMode) {
  const mode = String(surfaceMode || "default").trim().toLowerCase();
  const allowed = new Set(["bulk_lock", "block", "schedule", "utility", "free", "default"]);
  let normalized = allowed.has(mode) ? mode : "default";
  if (normalized === "bulk_lock") normalized = "block";
  const res = await query(
    `INSERT INTO student_mdm_app_allowance_profiles
      (user_id, provider, ui_surface_mode, updated_at)
     VALUES ($1, 'simplemdm', $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       ui_surface_mode = EXCLUDED.ui_surface_mode,
       updated_at = now()
     RETURNING ui_surface_mode`,
    [userId, normalized]
  );
  return res.rows[0] || null;
}

async function upsertStudentMdmAppAllowanceProfileState(userId, input = {}) {
  const res = await query(
    `INSERT INTO student_mdm_app_allowance_profiles
      (
        user_id,
        provider,
        profile_id,
        profile_name,
        profile_identifier,
        override_bundle_ids,
        override_updated_at,
        last_payload_hash,
        last_synced_at,
        last_error,
        updated_at
      )
     VALUES ($1, 'simplemdm', $2, $3, $4, $5::jsonb, $6, $7, $8, $9, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       profile_id = EXCLUDED.profile_id,
       profile_name = EXCLUDED.profile_name,
       profile_identifier = EXCLUDED.profile_identifier,
       override_bundle_ids = COALESCE(
         EXCLUDED.override_bundle_ids,
         student_mdm_app_allowance_profiles.override_bundle_ids
       ),
       override_updated_at = COALESCE(
         EXCLUDED.override_updated_at,
         student_mdm_app_allowance_profiles.override_updated_at
       ),
       last_payload_hash = EXCLUDED.last_payload_hash,
       last_synced_at = EXCLUDED.last_synced_at,
       last_error = EXCLUDED.last_error,
       updated_at = now()
     RETURNING profile_id,
               profile_name,
               profile_identifier,
               override_bundle_ids,
               override_updated_at,
               last_payload_hash,
               last_synced_at,
               last_error,
               updated_at`,
    [
      userId,
      input.profileId != null ? Number(input.profileId) : null,
      input.profileName != null ? String(input.profileName) : null,
      input.profileIdentifier != null ? String(input.profileIdentifier) : null,
      Array.isArray(input.overrideBundleIds)
        ? JSON.stringify(
            Array.from(
              new Set(
                input.overrideBundleIds
                  .map(value => String(value || "").trim().toLowerCase())
                  .filter(Boolean)
              )
            )
          )
        : null,
      input.overrideUpdatedAt != null ? input.overrideUpdatedAt : null,
      input.lastPayloadHash != null ? String(input.lastPayloadHash) : null,
      input.lastSyncedAt != null ? input.lastSyncedAt : null,
      input.lastError != null ? String(input.lastError) : null
    ]
  );
  return res.rows[0] || null;
}

/** Updates weekly allowance payload hash/sync metadata without touching named-profile columns (profile_id, etc.). */
async function touchStudentWeeklyAppAllowancePayloadSync(userId, payloadHash) {
  const nowIso = new Date().toISOString();
  const hash = payloadHash != null ? String(payloadHash) : null;
  await query(
    `INSERT INTO student_mdm_app_allowance_profiles
      (user_id, provider, last_payload_hash, last_synced_at, last_error, updated_at)
     VALUES ($1, 'simplemdm', $2, $3::timestamptz, NULL, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       last_payload_hash = EXCLUDED.last_payload_hash,
       last_synced_at = EXCLUDED.last_synced_at,
       last_error = NULL,
       updated_at = now()`,
    [userId, hash, nowIso]
  );
}

async function setStudentMdmAppAllowanceOverride(userId, bundleIds = []) {
  const normalizedBundleIds = Array.from(
    new Set(
      (Array.isArray(bundleIds) ? bundleIds : [])
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
  const res = await query(
    `INSERT INTO student_mdm_app_allowance_profiles
      (user_id, provider, override_bundle_ids, override_updated_at, updated_at)
     VALUES ($1, 'simplemdm', $2::jsonb, now(), now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       override_bundle_ids = EXCLUDED.override_bundle_ids,
       override_updated_at = now(),
       updated_at = now()
     RETURNING profile_id,
               profile_name,
               profile_identifier,
               override_bundle_ids,
               override_updated_at,
               last_payload_hash,
               last_synced_at,
               last_error,
               updated_at`,
    [userId, JSON.stringify(normalizedBundleIds)]
  );
  return res.rows[0] || null;
}

async function clearStudentMdmAppAllowanceOverride(userId) {
  const res = await query(
    `INSERT INTO student_mdm_app_allowance_profiles
      (user_id, provider, override_bundle_ids, override_updated_at, updated_at)
     VALUES ($1, 'simplemdm', NULL, NULL, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       override_bundle_ids = NULL,
       override_updated_at = NULL,
       updated_at = now()
     RETURNING profile_id,
               profile_name,
               profile_identifier,
               override_bundle_ids,
               override_updated_at,
               last_payload_hash,
               last_synced_at,
               last_error,
               updated_at`,
    [userId]
  );
  return res.rows[0] || null;
}

async function deleteStudentMdmAppAllowanceProfileState(userId) {
  const res = await query(
    `DELETE FROM student_mdm_app_allowance_profiles
     WHERE user_id = $1
       AND provider = 'simplemdm'`,
    [userId]
  );
  return res.rowCount > 0;
}

async function getStudentMdmKioskProfileState(userId) {
  const res = await query(
    `SELECT profile_id,
            profile_name,
            profile_identifier,
            previous_profile_id,
            previous_profile_name,
            previous_profile_identifier,
            locked_bundle_id,
            activation_source,
            auto_release_exempt,
            last_synced_at,
            last_error,
            updated_at
     FROM student_mdm_kiosk_profiles
     WHERE user_id = $1
       AND provider = 'simplemdm'
     LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function upsertStudentMdmKioskProfileState(userId, input = {}) {
  const res = await query(
    `INSERT INTO student_mdm_kiosk_profiles
      (
        user_id,
        provider,
        profile_id,
        profile_name,
        profile_identifier,
        previous_profile_id,
        previous_profile_name,
        previous_profile_identifier,
        locked_bundle_id,
        activation_source,
        auto_release_exempt,
        last_synced_at,
        last_error,
        updated_at
      )
     VALUES ($1, 'simplemdm', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       profile_id = EXCLUDED.profile_id,
       profile_name = EXCLUDED.profile_name,
       profile_identifier = EXCLUDED.profile_identifier,
       previous_profile_id = EXCLUDED.previous_profile_id,
       previous_profile_name = EXCLUDED.previous_profile_name,
       previous_profile_identifier = EXCLUDED.previous_profile_identifier,
       locked_bundle_id = EXCLUDED.locked_bundle_id,
       activation_source = EXCLUDED.activation_source,
       auto_release_exempt = EXCLUDED.auto_release_exempt,
       last_synced_at = EXCLUDED.last_synced_at,
       last_error = EXCLUDED.last_error,
       updated_at = now()
     RETURNING profile_id,
               profile_name,
               profile_identifier,
               previous_profile_id,
               previous_profile_name,
               previous_profile_identifier,
               locked_bundle_id,
               activation_source,
               auto_release_exempt,
               last_synced_at,
               last_error,
               updated_at`,
    [
      userId,
      input.profileId != null ? Number(input.profileId) : null,
      input.profileName != null ? String(input.profileName) : null,
      input.profileIdentifier != null ? String(input.profileIdentifier) : null,
      input.previousProfileId != null ? Number(input.previousProfileId) : null,
      input.previousProfileName != null ? String(input.previousProfileName) : null,
      input.previousProfileIdentifier != null
        ? String(input.previousProfileIdentifier)
        : null,
      input.lockedBundleId != null ? String(input.lockedBundleId) : null,
      input.activationSource != null ? String(input.activationSource) : null,
      Object.prototype.hasOwnProperty.call(input, "autoReleaseExempt")
        ? Boolean(input.autoReleaseExempt)
        : false,
      input.lastSyncedAt != null ? input.lastSyncedAt : null,
      input.lastError != null ? String(input.lastError) : null
    ]
  );
  return res.rows[0] || null;
}

async function deleteStudentMdmKioskProfileState(userId) {
  const res = await query(
    `DELETE FROM student_mdm_kiosk_profiles
     WHERE user_id = $1
       AND provider = 'simplemdm'`,
    [userId]
  );
  return res.rowCount > 0;
}

async function setStudentMdmKioskProfileSyncError(userId, errorMessage) {
  const res = await query(
    `INSERT INTO student_mdm_kiosk_profiles
      (user_id, provider, last_error, updated_at)
     VALUES ($1, 'simplemdm', $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       last_error = EXCLUDED.last_error,
       updated_at = now()
     RETURNING profile_id,
               profile_name,
               profile_identifier,
               previous_profile_id,
               previous_profile_name,
               previous_profile_identifier,
               locked_bundle_id,
               last_synced_at,
               last_error,
               updated_at`,
    [userId, String(errorMessage || '설정 반영 실패')]
  );
  return res.rows[0] || null;
}

async function setStudentMdmAppAllowanceProfileSyncError(userId, errorMessage) {
  const res = await query(
    `INSERT INTO student_mdm_app_allowance_profiles
      (user_id, provider, last_error, updated_at)
     VALUES ($1, 'simplemdm', $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       provider = 'simplemdm',
       last_error = EXCLUDED.last_error,
       updated_at = now()
     RETURNING profile_id,
               profile_name,
               profile_identifier,
               override_bundle_ids,
               override_updated_at,
               last_payload_hash,
               last_synced_at,
               last_error,
               updated_at`,
    [userId, String(errorMessage || '설정 반영 실패')]
  );
  return res.rows[0] || null;
}

async function listStudentIdsForWeeklyAppAllowanceEnforcement() {
  const res = await query(
    `SELECT DISTINCT user_id
     FROM (
       SELECT user_id FROM student_weekly_app_allowance_slots
       UNION
       SELECT user_id FROM student_mdm_app_allowance_profiles
     ) candidates
     ORDER BY user_id ASC`,
    []
  );
  return res.rows
    .map(row => Number(row.user_id))
    .filter(userId => Number.isFinite(userId) && userId > 0);
}

async function upsertStudentCoachProfile(userId, input = {}) {
  const res = await query(
    `INSERT INTO student_coach_profiles
      (user_id, name, school_level, grade, goal, goal_university, target_grade, current_concern, weakness, target_subjects, weak_subjects, sleep_time, wake_time, alarm_schedule_reminders, alarm_parent_link_alerts, alarm_study_room_alerts, alarm_message_alerts, alarm_homework_alerts, wake_alarm_enabled, wake_alarm_time, mdm_applied, initial_profile_completed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::text[], $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       name = COALESCE(EXCLUDED.name, student_coach_profiles.name),
       school_level = COALESCE(EXCLUDED.school_level, student_coach_profiles.school_level),
       grade = COALESCE(EXCLUDED.grade, student_coach_profiles.grade),
       goal = COALESCE(EXCLUDED.goal, student_coach_profiles.goal),
       goal_university = COALESCE(EXCLUDED.goal_university, student_coach_profiles.goal_university),
       target_grade = COALESCE(EXCLUDED.target_grade, student_coach_profiles.target_grade),
       current_concern = COALESCE(EXCLUDED.current_concern, student_coach_profiles.current_concern),
       weakness = COALESCE(EXCLUDED.weakness, student_coach_profiles.weakness),
       target_subjects = COALESCE(EXCLUDED.target_subjects, student_coach_profiles.target_subjects),
       weak_subjects = COALESCE(EXCLUDED.weak_subjects, student_coach_profiles.weak_subjects),
       sleep_time = COALESCE(EXCLUDED.sleep_time, student_coach_profiles.sleep_time),
       wake_time = COALESCE(EXCLUDED.wake_time, student_coach_profiles.wake_time),
       alarm_schedule_reminders = COALESCE(EXCLUDED.alarm_schedule_reminders, student_coach_profiles.alarm_schedule_reminders),
       alarm_parent_link_alerts = COALESCE(EXCLUDED.alarm_parent_link_alerts, student_coach_profiles.alarm_parent_link_alerts),
       alarm_study_room_alerts = COALESCE(EXCLUDED.alarm_study_room_alerts, student_coach_profiles.alarm_study_room_alerts),
      alarm_message_alerts = COALESCE(EXCLUDED.alarm_message_alerts, student_coach_profiles.alarm_message_alerts),
      alarm_homework_alerts = COALESCE(EXCLUDED.alarm_homework_alerts, student_coach_profiles.alarm_homework_alerts),
       wake_alarm_enabled = COALESCE(EXCLUDED.wake_alarm_enabled, student_coach_profiles.wake_alarm_enabled),
       wake_alarm_time = COALESCE(EXCLUDED.wake_alarm_time, student_coach_profiles.wake_alarm_time),
      mdm_applied = COALESCE(EXCLUDED.mdm_applied, student_coach_profiles.mdm_applied),
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
      input.goalUniversity || null,
      input.targetGrade || null,
      input.currentConcern || null,
      input.weakness || null,
      Array.isArray(input.targetSubjects) ? input.targetSubjects : null,
      Array.isArray(input.weakSubjects) ? input.weakSubjects : null,
      input.sleepTime || null,
      input.wakeTime || null,
      Object.prototype.hasOwnProperty.call(input, "scheduleReminders")
        ? Boolean(input.scheduleReminders)
        : null,
      Object.prototype.hasOwnProperty.call(input, "parentLinkAlerts")
        ? Boolean(input.parentLinkAlerts)
        : null,
      Object.prototype.hasOwnProperty.call(input, "studyRoomAlerts")
        ? Boolean(input.studyRoomAlerts)
        : null,
      Object.prototype.hasOwnProperty.call(input, "messageAlerts")
        ? Boolean(input.messageAlerts)
        : null,
      Object.prototype.hasOwnProperty.call(input, "homeworkAlerts")
        ? Boolean(input.homeworkAlerts)
        : null,
      Object.prototype.hasOwnProperty.call(input, "wakeAlarmEnabled")
        ? Boolean(input.wakeAlarmEnabled)
        : null,
      input.wakeAlarmTime || null,
      Object.prototype.hasOwnProperty.call(input, "mdmApplied")
        ? Boolean(input.mdmApplied)
        : null,
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

async function markStudentDailyRecordSectionSaved(userId, kind, recordDate = null) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (normalizedKind !== "study" && normalizedKind !== "life") {
    throw new Error("kind는 study 또는 life여야 합니다.");
  }
  const targetColumn =
    normalizedKind === "study" ? "study_saved_at" : "life_saved_at";
  const res = await query(
    `INSERT INTO student_daily_record_completion
      (user_id, record_date, ${targetColumn}, updated_at)
     VALUES ($1, COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date), now(), now())
     ON CONFLICT (user_id, record_date)
     DO UPDATE SET
       ${targetColumn} = now(),
       updated_at = now()
     RETURNING user_id,
               record_date,
               study_saved_at,
               life_saved_at,
               created_at,
               updated_at`,
    [userId, recordDate]
  );
  return res.rows[0] || null;
}

async function getStudentDailyRecordCompletion(userId, recordDate = null) {
  const res = await query(
    `SELECT user_id,
            record_date,
            study_saved_at,
            life_saved_at,
            created_at,
            updated_at
     FROM student_daily_record_completion
     WHERE user_id = $1
       AND record_date = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date)
     LIMIT 1`,
    [userId, recordDate]
  );
  const row = res.rows[0] || null;
  if (!row) {
    return {
      user_id: Number(userId),
      record_date: null,
      study_saved_at: null,
      life_saved_at: null,
      completed: false
    };
  }
  return {
    ...row,
    completed: Boolean(row.study_saved_at && row.life_saved_at)
  };
}

async function clearStudentDailyRecordCompletion(userId, recordDate = null) {
  const res = await query(
    `DELETE FROM student_daily_record_completion
     WHERE user_id = $1
       AND record_date = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date)`,
    [userId, recordDate]
  );
  return res.rowCount > 0;
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

async function listStudentCoachLogsInDateRange(userId, startDateIso, endDateIso) {
  const res = await query(
    `SELECT *
     FROM student_coach_logs
     WHERE user_id = $1
       AND log_date >= $2::date
       AND log_date <= $3::date
     ORDER BY log_date DESC, created_at DESC`,
    [userId, startDateIso, endDateIso]
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

function serializeStudentParentChatMessage(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    studentUserId: Number(row.student_user_id),
    parentUserId: Number(row.parent_user_id),
    senderRole: row.sender_role === "parent" ? "parent" : "student",
    content: String(row.content || ""),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString()
  };
}

async function insertStudentParentChatMessage(
  studentUserId,
  parentUserId,
  senderRole,
  content
) {
  const res = await query(
    `INSERT INTO student_parent_chat_messages
      (student_user_id, parent_user_id, sender_role, content)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [studentUserId, parentUserId, senderRole, String(content || "")]
  );
  return serializeStudentParentChatMessage(res.rows[0]);
}

async function listStudentParentChatMessages(
  studentUserId,
  parentUserId,
  limit = 60
) {
  const res = await query(
    `SELECT id, student_user_id, parent_user_id, sender_role, content, created_at
     FROM student_parent_chat_messages
     WHERE student_user_id = $1 AND parent_user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [studentUserId, parentUserId, Math.max(1, Number(limit) || 60)]
  );
  return res.rows.map(serializeStudentParentChatMessage).reverse();
}

function serializeHomeworkSubmission(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    studentUserId: Number(row.student_user_id),
    parentUserId: Number(row.parent_user_id),
    originalName: String(row.original_name || ""),
    storedName: String(row.stored_name || ""),
    fileUrl: String(row.file_url || ""),
    mimeType: row.mime_type != null ? String(row.mime_type) : null,
    fileSize:
      row.file_size != null && Number.isFinite(Number(row.file_size))
        ? Number(row.file_size)
        : null,
    note: row.note != null ? String(row.note) : "",
    reviewStatus:
      row.review_status === "approved"
        ? "approved"
        : row.review_status === "needs_revision"
          ? "needs_revision"
          : "pending",
    reviewComment: row.review_comment != null ? String(row.review_comment) : "",
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString(),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null
  };
}

async function createStudentHomeworkSubmission(studentUserId, parentUserId, input = {}) {
  const res = await query(
    `INSERT INTO student_homework_submissions
      (student_user_id, parent_user_id, original_name, stored_name, file_url, mime_type, file_size, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      studentUserId,
      parentUserId,
      String(input.originalName || "").trim(),
      String(input.storedName || "").trim(),
      String(input.fileUrl || "").trim(),
      input.mimeType != null ? String(input.mimeType).trim() : null,
      Number.isFinite(Number(input.fileSize)) ? Number(input.fileSize) : null,
      input.note != null ? String(input.note).trim() : null
    ]
  );
  return serializeHomeworkSubmission(res.rows[0]);
}

async function updateStudentHomeworkSubmission(
  studentUserId,
  parentUserId,
  submissionId,
  input = {}
) {
  const currentRes = await query(
    `SELECT *
     FROM student_homework_submissions
     WHERE id = $1 AND student_user_id = $2 AND parent_user_id = $3`,
    [submissionId, studentUserId, parentUserId]
  );
  const current = currentRes.rows[0];
  if (!current) return null;

  const res = await query(
    `UPDATE student_homework_submissions
     SET original_name = $4,
         stored_name = $5,
         file_url = $6,
         mime_type = $7,
         file_size = $8,
         note = $9,
         review_status = 'pending',
         review_comment = '',
         reviewed_at = NULL
     WHERE id = $1 AND student_user_id = $2 AND parent_user_id = $3
     RETURNING *`,
    [
      submissionId,
      studentUserId,
      parentUserId,
      input.originalName != null ? String(input.originalName).trim() : String(current.original_name || ""),
      input.storedName != null ? String(input.storedName).trim() : String(current.stored_name || ""),
      input.fileUrl != null ? String(input.fileUrl).trim() : String(current.file_url || ""),
      input.mimeType != null ? String(input.mimeType).trim() : current.mime_type,
      Number.isFinite(Number(input.fileSize)) ? Number(input.fileSize) : current.file_size,
      input.note != null ? String(input.note).trim() : current.note
    ]
  );

  return {
    previous: serializeHomeworkSubmission(current),
    submission: serializeHomeworkSubmission(res.rows[0])
  };
}

async function listStudentHomeworkSubmissions(
  studentUserId,
  parentUserId,
  limit = 20
) {
  const res = await query(
    `SELECT *
     FROM student_homework_submissions
     WHERE student_user_id = $1 AND parent_user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [studentUserId, parentUserId, Math.max(1, Number(limit) || 20)]
  );
  return res.rows.map(serializeHomeworkSubmission);
}

async function deleteStudentHomeworkSubmission(studentUserId, parentUserId, submissionId) {
  const res = await query(
    `DELETE FROM student_homework_submissions
     WHERE id = $1 AND student_user_id = $2 AND parent_user_id = $3
     RETURNING *`,
    [submissionId, studentUserId, parentUserId]
  );
  return serializeHomeworkSubmission(res.rows[0]);
}

async function reviewStudentHomeworkSubmission(
  studentUserId,
  parentUserId,
  submissionId,
  reviewStatus,
  reviewComment
) {
  const res = await query(
    `UPDATE student_homework_submissions
     SET review_status = $4,
         review_comment = $5,
         reviewed_at = now()
     WHERE id = $1 AND student_user_id = $2 AND parent_user_id = $3
     RETURNING *`,
    [submissionId, studentUserId, parentUserId, reviewStatus, reviewComment || null]
  );
  return serializeHomeworkSubmission(res.rows[0]);
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

function studyBlockIntervalsOverlap(aStart, aEnd, bStart, bEnd) {
  const as = blockTimeSortKeyMin(aStart);
  const ae = blockTimeSortKeyMin(aEnd);
  const bs = blockTimeSortKeyMin(bStart);
  const be = blockTimeSortKeyMin(bEnd);
  if (ae <= as || be <= bs) return false;
  return as < be && bs < ae;
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

async function listPendingPlanAddRequestsForParent(parentUserId, limit = 100) {
  const res = await query(
    `SELECT r.id, r.student_user_id, r.target_date, r.book_id, r.planned_range,
            r.start_time, r.end_time, r.subject_snapshot, r.created_at,
            u.email AS student_email
     FROM parent_plan_add_requests r
     INNER JOIN users u ON u.id = r.student_user_id
     INNER JOIN parents p ON p.user_id = $1
     INNER JOIN parents_students ps ON ps.parent_id = p.id AND ps.student_id = r.student_user_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at ASC
     LIMIT $2`,
    [parentUserId, Math.max(1, Math.min(300, Number(limit) || 100))]
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
  const reqStart = hhmmFromDb(row.start_time);
  const reqEnd = hhmmFromDb(row.end_time);
  const withoutOverlapping = existing.filter(
    b => !studyBlockIntervalsOverlap(b.startTime, b.endTime, reqStart, reqEnd)
  );
  const merged = sortReplaceBlocks([...withoutOverlapping, newBlock]);
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

async function createStudentNotification(userId, title, body) {
  const res = await query(
    `INSERT INTO student_in_app_notifications (user_id, title, body)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, String(title || ""), body != null ? String(body) : null]
  );
  return res.rows[0] || null;
}

async function createParentNotification(userId, title, body) {
  const res = await query(
    `INSERT INTO parent_in_app_notifications (user_id, title, body)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, String(title || ""), body != null ? String(body) : null]
  );
  return res.rows[0] || null;
}

async function createParentNotificationForAlarm(userId, alarmKey, title, body) {
  const settings = await getParentAlarmSettings(userId);
  if (!settings || settings[alarmKey] !== true) {
    return null;
  }
  return createParentNotification(userId, title, body);
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
  const values = [];
  const params = [];
  parentUserIds.forEach((parentUserId, index) => {
    const base = index * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(parentUserId, String(title || ""), body != null ? String(body) : null);
  });
  await query(
    `INSERT INTO parent_in_app_notifications (user_id, title, body)
     VALUES ${values.join(", ")}`,
    params
  );
  return parentUserIds.length;
}

async function upsertUserPushToken(userId, input = {}) {
  const platform = String(input.platform || "ios").trim().toLowerCase();
  const deviceToken = String(input.deviceToken || "").trim();
  const bundleId = input.bundleId != null ? String(input.bundleId).trim() : null;
  const res = await query(
    `INSERT INTO user_push_tokens
      (user_id, platform, device_token, bundle_id, active, last_registered_at, updated_at, last_error)
     VALUES ($1, $2, $3, $4, true, now(), now(), NULL)
     ON CONFLICT (platform, device_token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       bundle_id = EXCLUDED.bundle_id,
       active = true,
       last_registered_at = now(),
       updated_at = now(),
       last_error = NULL
     RETURNING id, user_id, platform, device_token, bundle_id, active, last_registered_at, updated_at, last_error`,
    [userId, platform, deviceToken, bundleId]
  );
  return res.rows[0] || null;
}

async function deactivateUserPushToken(userId, input = {}) {
  const platform = String(input.platform || "ios").trim().toLowerCase();
  const deviceToken = String(input.deviceToken || "").trim();
  const res = await query(
    `UPDATE user_push_tokens
     SET active = false,
         updated_at = now()
     WHERE user_id = $1 AND platform = $2 AND device_token = $3
     RETURNING id`,
    [userId, platform, deviceToken]
  );
  return (res.rowCount || 0) > 0;
}

async function listActiveUserPushTokens(userId, platform = null) {
  const normalizedPlatform = platform != null ? String(platform).trim().toLowerCase() : null;
  const res = await query(
    `SELECT id, user_id, platform, device_token, bundle_id, active, last_registered_at, last_sent_at, last_error, created_at, updated_at
     FROM user_push_tokens
     WHERE user_id = $1
       AND active = true
       AND ($2::text IS NULL OR platform = $2)
     ORDER BY updated_at DESC`,
    [userId, normalizedPlatform]
  );
  return res.rows;
}

async function markUserPushTokenSent(tokenId) {
  await query(
    `UPDATE user_push_tokens
     SET last_sent_at = now(),
         last_error = NULL,
         updated_at = now()
     WHERE id = $1`,
    [tokenId]
  );
}

async function markUserPushTokenError(tokenId, errorText, deactivate = false) {
  await query(
    `UPDATE user_push_tokens
     SET last_error = $2,
         active = CASE WHEN $3::boolean THEN false ELSE active END,
         updated_at = now()
     WHERE id = $1`,
    [tokenId, errorText != null ? String(errorText).slice(0, 500) : null, Boolean(deactivate)]
  );
}

module.exports = {
  pool,
  query,
  ensureConnected,
  findUserByEmail,
  createUser,
  getMe,
  getStudentAlarmSettings,
  getParentAlarmSettings,
  upsertParentAlarmSettings,
  getUserByIdForAuth,
  updateUserEmail,
  updateUserPasswordHash,
  deleteUser,
  listParentStudents,
  listLinkedParentUserIdsForStudent,
  listLinkedParentPhonesForStudent,
  upsertParentSignupPhoneOtp,
  deleteParentSignupPhoneOtp,
  parentPhoneNormalizedExists,
  parentPhoneNormalizedTakenByOtherParent,
  verifyParentSignupPhoneOtp,
  assertParentSignupPhoneResendCooldown,
  setParentPhoneForUser,
  getParentPhoneByUserId,
  getParentCoachCustomization,
  upsertParentCoachCustomization,
  getEffectiveParentCoachCustomizationForStudent,
  listStudentParents,
  parentRequestLink,
  studentRequestParent,
  listParentLinkRequests,
  listStudentLinkRequests,
  studentConfirmLinkRequest,
  parentConfirmLinkRequest,
  rejectLinkRequest,
  createUnlinkRequest,
  confirmUnlinkRequest,
  rejectUnlinkRequest,
  unlinkParentStudent,
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
  getStudentMdmAppAllowanceProfileState,
  upsertStudentMdmAppAllowanceProfileState,
  touchStudentWeeklyAppAllowancePayloadSync,
  upsertStudentMdmAppAllowanceUiSurfaceMode,
  setStudentMdmAppAllowanceOverride,
  clearStudentMdmAppAllowanceOverride,
  deleteStudentMdmAppAllowanceProfileState,
  getStudentMdmKioskProfileState,
  upsertStudentMdmKioskProfileState,
  deleteStudentMdmKioskProfileState,
  setStudentMdmKioskProfileSyncError,
  setStudentMdmAppAllowanceProfileSyncError,
  listStudentIdsForWeeklyAppAllowanceEnforcement,
  upsertStudentCoachProfile,
  getStudentCoachProfile,
  insertStudentCoachLog,
  upsertStudentCoachLog,
  setStudentCoachLogTomorrowPractice,
  setStudentCoachLogTomorrowPracticeDone,
  markStudentDailyRecordSectionSaved,
  getStudentDailyRecordCompletion,
  clearStudentDailyRecordCompletion,
  listRecentStudentCoachLogs,
  listStudentCoachLogsInWeekRange,
  listStudentCoachLogsInDateRange,
  insertStudentCoachMessage,
  listRecentStudentCoachMessages,
  insertStudentParentChatMessage,
  listStudentParentChatMessages,
  createStudentHomeworkSubmission,
  updateStudentHomeworkSubmission,
  listStudentHomeworkSubmissions,
  deleteStudentHomeworkSubmission,
  reviewStudentHomeworkSubmission,
  countUnreadStudentNotifications,
  listStudentNotifications,
  markStudentNotificationsReadAll,
  createStudentNotification,
  createParentNotification,
  createParentNotificationForAlarm,
  countUnreadParentNotifications,
  listParentNotifications,
  markParentNotificationsReadAll,
  createParentNotificationForLinkedParents,
  upsertUserPushToken,
  deactivateUserPushToken,
  listActiveUserPushTokens,
  markUserPushTokenSent,
  markUserPushTokenError,
  upsertParentStudentStudyRoom,
  deleteParentStudentStudyRoom,
  getParentStudentAppModeSchedule,
  upsertParentStudentAppModeSchedule,
  listAllParentStudentAppModeScheduleRows,
  listStudyRoomConfigurationsForStudent,
  listCurrentStudyRoomDistancesForStudent,
  recordStudentStudyRoomHeartbeat,
  listRecentStudyRoomVisitSessionsForStudent,
  listRecentStudyRoomVisitSessionsForParent,
  getOrCreateStudyDay,
  replaceStudyBlocks,
  upsertStudyPlans,
  getWeekData,
  getStudyPlansForDate,
  listStudentWeeklyAppAllowanceSlots,
  replaceStudentWeeklyAppAllowanceSlots,
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


