"use strict";

const { detectSignal } = require("./feedback/signalDetector");
const { sendBackgroundPushToUser } = require("./pushService");
const {
  syncStudentWeeklyAppAllowance,
  removeStudentWeeklyAppAllowanceRestriction
} = require("./weeklyAppAllowanceEnforcement");
const {
  isSimpleMdmConfigured,
  findDeviceBySerial,
  refreshDevice,
  createAssignmentGroup,
  assignDeviceToGroup,
  findProfileByName,
  assignProfileToGroup,
  unassignCompetingAppAllowanceProfilesFromGroup,
  syncProfiles
} = require("./simpleMdmClient");
const {
  query: dbQuery,
  getActiveDeviceSerialForUser,
  getStudentMdmGroup,
  upsertStudentMdmGroup,
  getStudentMdmAppAllowanceProfileState,
  upsertStudentMdmAppAllowanceProfileState,
  upsertStudentCoachProfile,
  clearStudentMdmAppAllowanceOverride,
  listStudentWeeklyAppAllowanceSlots,
  listCurrentStudyRoomDistancesForStudent,
  listRecentStudyRoomVisitSessionsForParent,
  listStudyRoomConfigurationsForStudent
} = require("./db");

const PATTERN_INSIGHTS_CACHE_TTL_MS = 5 * 60 * 1000;
const PATTERN_INSIGHTS_CACHE_MAX_ENTRIES = 200;
const LOCK_STATUS_CACHE_TTL_MS = 8 * 1000;
const LOCK_STATUS_CACHE_MAX_ENTRIES = 300;
const RESPONSE_CACHE_TTL_MS = 15 * 1000;
const RESPONSE_CACHE_MAX_ENTRIES = 500;
const SIMPLEMDM_LOCATION_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function isIsoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

const simpleMdmLocationRefreshAtByDeviceId = new Map();
const patternInsightsCache = new Map();
/** 직전 코치 응답 로그 id — 다음 사용자 메시지에서 signal 반영 (express-session 미사용, userId 키). */
const lastCoachResponseLogIdByUserId = new Map();
const lockStatusCache = new Map();
const responseCache = new Map();
const DAECHI_ROOT_BUNDLE_ID = "com.daechiroot.ios";
const APP_ALLOWANCE_MODE_TO_PROFILE_NAME = Object.freeze({
  default: String(process.env.SIMPLEMDM_APP_ALLOWANCE_DEFAULT_PROFILE || "default").trim(),
  utility: String(process.env.SIMPLEMDM_APP_ALLOWANCE_UTILITY_PROFILE || "utility").trim(),
  free: String(process.env.SIMPLEMDM_APP_ALLOWANCE_FREE_PROFILE || "free").trim(),
  block: String(process.env.SIMPLEMDM_APP_ALLOWANCE_BLOCK_PROFILE || "block").trim()
});

function coachResponseLogSessionId(req, extra = "") {
  const fromBody =
    req.body && req.body.sessionId != null ? String(req.body.sessionId).trim() : "";
  if (fromBody) return fromBody.slice(0, 200);
  const uid = Number(req.userId);
  if (Number.isFinite(uid)) return `user:${uid}${extra ? `:${extra}` : ""}`;
  return "anonymous";
}

async function applyCoachSignalFromPreviousTurn(userId, userType, message) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return;
  const lastLogId = lastCoachResponseLogIdByUserId.get(uid);
  if (!lastLogId) return;
  const ut = userType === "parent" ? "parent" : "student";
  const { signal, reason } = detectSignal(String(message || ""), ut);
  if (signal !== "neutral") {
    try {
      await dbQuery(
        `UPDATE coach_response_log SET signal = $1, signal_reason = $2 WHERE id = $3`,
        [signal, reason, lastLogId]
      );
    } catch (err) {
      console.error("[coach_response_log] signal 업데이트 실패:", err);
    }
  }
  lastCoachResponseLogIdByUserId.delete(uid);
}

async function insertCoachResponseLogRow({
  sessionId,
  userType,
  coachMode,
  userMessage,
  aiResponse,
  contextSnapshot,
  userIdForSignalLink
}) {
  try {
    const logResult = await dbQuery(
      `INSERT INTO coach_response_log
       (session_id, user_type, coach_mode, user_message, ai_response, context_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        sessionId,
        userType,
        coachMode,
        String(userMessage ?? "").slice(0, 12000),
        String(aiResponse ?? "").slice(0, 12000),
        contextSnapshot && typeof contextSnapshot === "object" ? contextSnapshot : null
      ]
    );
    const id = logResult.rows[0]?.id;
    if (
      userIdForSignalLink != null &&
      Number.isFinite(Number(userIdForSignalLink)) &&
      Number.isFinite(Number(id))
    ) {
      lastCoachResponseLogIdByUserId.set(Number(userIdForSignalLink), Number(id));
    }
    return Number(id);
  } catch (err) {
    console.error("[coach_response_log] 저장 실패:", err);
    return null;
  }
}

function coachContextSnapshotFromStudentSnapshot(snapshot) {
  if (!snapshot || !snapshot.metrics) return null;
  const m = snapshot.metrics;
  const stress = m.stress != null ? Number(m.stress) : null;
  const conc = m.concentration != null ? Number(m.concentration) : null;
  return {
    sleepHours: m.sleepHours != null ? Number(m.sleepHours) : null,
    stressScore: Number.isFinite(stress) ? stress : null,
    concentrationPercent: Number.isFinite(conc) ? conc : null,
    planCompletionRate:
      m.planCompletionRate != null ? Number(m.planCompletionRate) : null
  };
}

function coachContextSnapshotFromTomorrowContext(context) {
  if (!context || typeof context !== "object") return null;
  return {
    collabFocus: context.collabFocus ?? null,
    todayProgressPercent: context.todayProgressPercent ?? null
  };
}

function resolveAppAllowanceModeFromProfileName(profileNameRaw) {
  const profileName = normalizeSimpleMdmProfileName(profileNameRaw);
  if (!profileName) return "default";
  for (const [mode, configuredProfileName] of Object.entries(APP_ALLOWANCE_MODE_TO_PROFILE_NAME)) {
    if (normalizeSimpleMdmProfileName(configuredProfileName) === profileName) {
      return mode;
    }
  }
  return "default";
}

/** jsonb / 직렬화 이슈로 배열이 아닌 형태로 올 수 있음 */
function coerceOverrideBundleIdsArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
    try {
      const p = JSON.parse(raw.toString("utf8"));
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === "object") {
    const vals = Object.values(raw);
    if (vals.length > 0 && vals.every(v => typeof v === "string")) {
      return vals;
    }
  }
  return [];
}

/** 대치루트만 허용하는 일괄잠금(override) 여부 */
function isDaechiRootBulkLockOverride(overrideBundleIds) {
  const ids = Array.from(
    new Set(
      coerceOverrideBundleIdsArray(overrideBundleIds)
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
  return ids.length === 1 && ids[0] === DAECHI_ROOT_BUNDLE_ID.toLowerCase();
}

/** UI용: block(일괄잠금) / 계획표(주간 슬롯) / 유틸리티 / 자유시간 / 기본 */
function resolveMdmSurfaceMode(appAllowanceModeKey, weeklySlotCount) {
  const mode = String(appAllowanceModeKey || "default").trim().toLowerCase();
  if (mode === "utility") return "utility";
  if (mode === "free") return "free";
  if (mode === "block") return "block";
  if (mode === "default") {
    return Number(weeklySlotCount) > 0 ? "schedule" : "default";
  }
  return "default";
}

function resolveMdmSurfaceModeForParent(appAllowanceState, appAllowanceModeKey, weeklySlotCount) {
  const mode = String(appAllowanceModeKey || "default").trim().toLowerCase();
  if (mode === "block") return "block";
  if (isDaechiRootBulkLockOverride(appAllowanceState?.override_bundle_ids)) {
    return "block";
  }
  return resolveMdmSurfaceMode(appAllowanceModeKey, weeklySlotCount);
}

function normalizeModeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeSimpleMdmProfileName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getPatternInsightsCache(key) {
  const cached = patternInsightsCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.at || 0) > PATTERN_INSIGHTS_CACHE_TTL_MS) {
    patternInsightsCache.delete(key);
    return null;
  }
  // LRU touch
  patternInsightsCache.delete(key);
  patternInsightsCache.set(key, cached);
  return cached.value;
}

function setPatternInsightsCache(key, value) {
  if (patternInsightsCache.size >= PATTERN_INSIGHTS_CACHE_MAX_ENTRIES) {
    const oldestKey = patternInsightsCache.keys().next().value;
    if (oldestKey) patternInsightsCache.delete(oldestKey);
  }
  patternInsightsCache.set(key, { at: Date.now(), value });
}

function normalizeWeekStartForCache(weekStartRaw) {
  const weekStart = String(weekStartRaw || "").trim();
  if (!weekStart) return "recent";
  return isIsoDate(weekStart) ? weekStart : "recent";
}

function buildPatternCacheKey(scope, userId, studentId, weekStartRaw) {
  const week = normalizeWeekStartForCache(weekStartRaw);
  if (scope === "parent") {
    return `parent:${Number(userId) || 0}:${Number(studentId) || 0}:${week}`;
  }
  return `student:${Number(userId) || 0}:${week}`;
}

function invalidatePatternInsightsCacheForStudent(studentUserId) {
  const sid = Number(studentUserId) || 0;
  if (!sid) return;
  const prefixes = [`student:${sid}:`, `parent:`];
  for (const key of patternInsightsCache.keys()) {
    if (String(key).startsWith(prefixes[0])) {
      patternInsightsCache.delete(key);
      continue;
    }
    if (String(key).startsWith(prefixes[1]) && String(key).includes(`:${sid}:`)) {
      patternInsightsCache.delete(key);
    }
  }
}

function getResponseCache(key) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.at || 0) > RESPONSE_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  // LRU touch
  responseCache.delete(key);
  responseCache.set(key, cached);
  return cached.value;
}

function setResponseCache(key, value) {
  if (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { at: Date.now(), value });
}

function invalidateResponseCacheByPrefix(prefix) {
  const normalized = String(prefix || "");
  if (!normalized) return;
  for (const key of responseCache.keys()) {
    if (String(key).startsWith(normalized)) {
      responseCache.delete(key);
    }
  }
}

function buildParentStudyRoomVisitsCacheKey(parentUserId, studentId, limit) {
  return `parent-study-room-visits:${Number(parentUserId) || 0}:${Number(studentId) || 0}:${Number(limit) || 6}`;
}

function getLockStatusCache(key) {
  const cached = lockStatusCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.at || 0) > LOCK_STATUS_CACHE_TTL_MS) {
    lockStatusCache.delete(key);
    return null;
  }
  // LRU touch
  lockStatusCache.delete(key);
  lockStatusCache.set(key, cached);
  return cached.value;
}

function setLockStatusCache(key, value) {
  if (lockStatusCache.size >= LOCK_STATUS_CACHE_MAX_ENTRIES) {
    const oldestKey = lockStatusCache.keys().next().value;
    if (oldestKey) lockStatusCache.delete(oldestKey);
  }
  lockStatusCache.set(key, { at: Date.now(), value });
}

function invalidateLockStatusCacheForStudent(studentUserId) {
  const sid = Number(studentUserId) || 0;
  if (!sid) return;
  for (const key of lockStatusCache.keys()) {
    const text = String(key);
    if (text === `student-lock:${sid}` || text.includes(`:${sid}`)) {
      lockStatusCache.delete(key);
    }
  }
}

async function asyncMapWithConcurrency(items, mapper, concurrency = 4) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(8, Number(concurrency) || 4));
  const results = new Array(list.length);
  let index = 0;

  async function worker() {
    while (index < list.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(list[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

async function ensureStudentAssignmentGroupForProfile(userId, deviceId) {
  let group = await getStudentMdmGroup(userId);
  if (!group) {
    const created = await createAssignmentGroup(`student-${userId}`);
    if (!created?.id) {
      throw new Error("학생용 SimpleMDM assignment group 생성에 실패했습니다.");
    }
    group = await upsertStudentMdmGroup(
      userId,
      Number(created.id),
      created.attributes?.name || `student-${userId}`
    );
  }
  await assignDeviceToGroup(Number(group.assignment_group_id), Number(deviceId));
  return {
    id: Number(group.assignment_group_id),
    name: String(group.assignment_group_name || `student-${userId}`)
  };
}

async function applyNamedAppAllowanceProfileForStudent(userId, modeKey) {
  if (!isSimpleMdmConfigured()) {
    throw new Error("SimpleMDM 연동이 설정되지 않았습니다.");
  }
  const normalizedMode = normalizeModeKey(modeKey);
  const profileName = APP_ALLOWANCE_MODE_TO_PROFILE_NAME[normalizedMode];
  if (!profileName) {
    throw new Error("지원하지 않는 허용앱 모드입니다.");
  }

  const serial = await getActiveDeviceSerialForUser(userId);
  if (!serial) {
    throw new Error("학생 기기 시리얼이 등록되지 않았습니다.");
  }
  const device = await findDeviceBySerial(serial);
  if (!device?.id) {
    throw new Error("SimpleMDM에서 학생 기기를 찾을 수 없습니다.");
  }

  const group = await ensureStudentAssignmentGroupForProfile(userId, Number(device.id));
  const targetProfile = await findProfileByName(profileName);
  if (!targetProfile?.id) {
    throw new Error(`SimpleMDM 프로파일 '${profileName}'을 찾지 못했습니다.`);
  }

  const managedProfileNameSet = new Set(
    Object.values(APP_ALLOWANCE_MODE_TO_PROFILE_NAME)
      .map(normalizeSimpleMdmProfileName)
      .filter(Boolean)
  );
  const targetProfileId = Number(targetProfile.id);

  // 목표 이름 프로파일을 먼저 붙인 뒤 나머지를 뗀다. (기존에 block 등만 있을 때
  // 주간 sync가 utility/free/block 없는 순간으로 보고 default·주간 프로파일을 끼워 넣는 레이스 방지)
  await assignProfileToGroup(group.id, targetProfileId);
  const removedProfileIds = await unassignCompetingAppAllowanceProfilesFromGroup(group.id, {
    targetProfileId,
    managedNameKeys: managedProfileNameSet,
    syncAfter: false
  });

  await clearStudentMdmAppAllowanceOverride(userId).catch(() => {});
  await removeStudentWeeklyAppAllowanceRestriction(userId, {
    syncAfterUnassign: false
  }).catch(() => {});

  await syncProfiles(group.id).catch(() => {});

  const persistedName = String(targetProfile?.attributes?.name || profileName).trim();
  const persistedIdentifier =
    targetProfile?.attributes?.profile_identifier != null
      ? String(targetProfile.attributes.profile_identifier).trim()
      : null;
  await upsertStudentMdmAppAllowanceProfileState(userId, {
    profileId: targetProfileId,
    profileName: persistedName,
    profileIdentifier: persistedIdentifier || null,
    lastPayloadHash: null,
    lastSyncedAt: new Date().toISOString(),
    lastError: null
  });

  await upsertStudentCoachProfile(userId, { mdmApplied: true }).catch(() => {});

  return {
    mode: normalizedMode,
    profileId: targetProfileId,
    profileName: persistedName,
    removedProfileIds,
    groupId: group.id
  };
}

/**
 * 네 가지 축 중 "기본"(계획표 주간 프로파일 또는 이름 기반 default)이 비지 않도록 맞춘다.
 * 일괄잠금(override)·유틸·자유가 아닐 때는 슬롯이 있으면 주간 동기화, 없으면 default 이름 프로파일을 올린다.
 */
async function ensureBaselineAppAllowanceForStudent(userId, options = {}) {
  if (!isSimpleMdmConfigured()) {
    return { ok: false, skipped: true, reason: "simplemdm_not_configured" };
  }
  const allowanceState = await getStudentMdmAppAllowanceProfileState(userId);
  const namedMode = resolveAppAllowanceModeFromProfileName(allowanceState?.profile_name);
  if (namedMode === "block" && !options.afterParentAppModeScheduleSlot) {
    return { ok: true, skipped: true, reason: "block_named_profile" };
  }
  if (isDaechiRootBulkLockOverride(allowanceState?.override_bundle_ids)) {
    await clearStudentMdmAppAllowanceOverride(userId).catch(() => {});
    await applyNamedAppAllowanceProfileForStudent(userId, "block");
    return { ok: true, applied: "block_named", legacyOverrideMigrated: true };
  }
  const slots = await listStudentWeeklyAppAllowanceSlots(userId);
  if (slots.length > 0) {
    return syncStudentWeeklyAppAllowance(userId, {
      force: true,
      reason: options.reason || "ensure_baseline"
    });
  }
  await applyNamedAppAllowanceProfileForStudent(userId, "default");
  return { ok: true, applied: "default_named" };
}

async function buildParentTimedFreeRestoreSnapshot(userId) {
  const allowanceState = await getStudentMdmAppAllowanceProfileState(userId);
  const namedMode = resolveAppAllowanceModeFromProfileName(allowanceState?.profile_name);
  const bulkDaechiLock = isDaechiRootBulkLockOverride(allowanceState?.override_bundle_ids);
  const slots = await listStudentWeeklyAppAllowanceSlots(userId);
  return {
    version: 1,
    namedMode: namedMode === "free" ? "default" : namedMode,
    weeklySlotCount: slots.length,
    bulkDaechiLock
  };
}

/** 자유시간 종료(수동 default 또는 만료) 시 MDM 허용앱 상태를 진입 직전으로 복구합니다. */
async function restoreParentAppAllowanceAfterParentFree(userId, restoreSnapshot) {
  if (!isSimpleMdmConfigured()) {
    return { ok: false, skipped: true, reason: "simplemdm_not_configured" };
  }
  const snap =
    restoreSnapshot && typeof restoreSnapshot === "object" && !Array.isArray(restoreSnapshot)
      ? restoreSnapshot
      : {};
  if (!snap || Object.keys(snap).length === 0) {
    return ensureBaselineAppAllowanceForStudent(userId, {
      reason: "parent_free_restore_empty_snapshot",
      afterParentAppModeScheduleSlot: true
    });
  }
  const namedMode = normalizeModeKey(snap.namedMode || "default");
  const weeklySlotCount = Math.max(0, Math.floor(Number(snap.weeklySlotCount) || 0));
  const bulkDaechiLock = Boolean(snap.bulkDaechiLock);

  if (bulkDaechiLock) {
    await clearStudentMdmAppAllowanceOverride(userId).catch(() => {});
    await applyNamedAppAllowanceProfileForStudent(userId, "block");
    return { ok: true, applied: "bulk_block", reason: "parent_free_restore" };
  }

  await clearStudentMdmAppAllowanceOverride(userId).catch(() => {});

  if (namedMode === "default" && weeklySlotCount > 0) {
    const sync = await syncStudentWeeklyAppAllowance(userId, {
      force: true,
      reason: "parent_free_restore_weekly"
    });
    return { ok: Boolean(sync?.ok !== false), applied: "weekly", sync };
  }

  if (namedMode === "utility" || namedMode === "block") {
    const applied = await applyNamedAppAllowanceProfileForStudent(userId, namedMode);
    return { ok: true, applied: namedMode, profileApply: applied };
  }

  const applied = await applyNamedAppAllowanceProfileForStudent(userId, "default");
  return { ok: true, applied: "default_named", profileApply: applied };
}

function resolveHomeworkUploadPath(fileUrl) {
  const raw = String(fileUrl || "").trim();
  if (!raw.startsWith("/uploads/homework/")) return null;
  const fileName = path.basename(raw);
  if (!fileName) return null;
  return path.join(HOMEWORK_UPLOADS_DIR, fileName);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = value => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLng = toRad(Number(lng2) - Number(lng1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function parseIsoMs(value) {
  if (!value) return null;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function coerceFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyLocationToStudyRoomSummary(liveSummary, location) {
  return {
    ...liveSummary,
    currentLatitude:
      location.latitude != null && Number.isFinite(Number(location.latitude))
        ? Number(location.latitude)
        : liveSummary.currentLatitude ?? null,
    currentLongitude:
      location.longitude != null && Number.isFinite(Number(location.longitude))
        ? Number(location.longitude)
        : liveSummary.currentLongitude ?? null,
    currentHeartbeatAt: location.updatedAt,
    currentAccuracyMeters: location.accuracy,
    rooms: (Array.isArray(liveSummary.rooms) ? liveSummary.rooms : []).map(room => {
      const currentDistanceMeters = haversineMeters(
        location.latitude,
        location.longitude,
        room.latitude,
        room.longitude
      );
      return {
        ...room,
        currentDistanceMeters,
        isWithinRadius: currentDistanceMeters <= Number(room.radiusMeters || 0)
      };
    })
  };
}

async function getMergedStudyRoomTrackingSummary(studentUserId) {
  const liveSummary = await listCurrentStudyRoomDistancesForStudent(studentUserId);
  if (!isSimpleMdmConfigured()) {
    return liveSummary;
  }

  const linkedSerial = await getActiveDeviceSerialForUser(studentUserId);
  if (!linkedSerial) {
    return liveSummary;
  }

  const device = await findDeviceBySerial(linkedSerial).catch(() => null);
  const attrs = device?.attributes || null;
  const latitude = coerceFiniteNumber(attrs?.location_latitude);
  const longitude = coerceFiniteNumber(attrs?.location_longitude);
  const updatedAt = attrs?.location_updated_at ? new Date(String(attrs.location_updated_at)).toISOString() : null;
  const accuracy = coerceFiniteNumber(attrs?.location_accuracy);

  const appLocationMs = parseIsoMs(liveSummary.currentHeartbeatAt);
  const mdmLocationMs = parseIsoMs(updatedAt);
  const shouldUseSimpleMdmLocation =
    latitude != null &&
    longitude != null &&
    mdmLocationMs != null &&
    (appLocationMs == null || mdmLocationMs > appLocationMs);

  const appLocationIsStale = appLocationMs == null || Date.now() - appLocationMs > SIMPLEMDM_LOCATION_REFRESH_COOLDOWN_MS;
  const deviceId = Number(device?.id || 0);
  if (deviceId > 0 && appLocationIsStale) {
    const lastRefreshAt = simpleMdmLocationRefreshAtByDeviceId.get(deviceId) || 0;
    if (Date.now() - lastRefreshAt > SIMPLEMDM_LOCATION_REFRESH_COOLDOWN_MS) {
      simpleMdmLocationRefreshAtByDeviceId.set(deviceId, Date.now());
      void refreshDevice(deviceId).catch(() => {
        // ignore best-effort SimpleMDM refresh failures
      });
    }
  }

  if (!shouldUseSimpleMdmLocation) {
    return liveSummary;
  }

  return applyLocationToStudyRoomSummary(liveSummary, {
    latitude,
    longitude,
    accuracy,
    updatedAt
  });
}

const parentLocationRefreshAtByStudentId = new Map();

async function requestStudentAppLocationRefresh(studentId) {
  try {
    await sendBackgroundPushToUser(Number(studentId), { type: "location_refresh" });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function buildParentStudyRoomVisitsResponse(parentUserId, studentId, limit = 6) {
  const pid = Number(parentUserId) || 0;
  const sid = Number(studentId) || 0;
  const [liveSummary, visits, roomConfigs] = await Promise.all([
    getMergedStudyRoomTrackingSummary(sid),
    listRecentStudyRoomVisitSessionsForParent(pid, sid, limit),
    listStudyRoomConfigurationsForStudent(sid)
  ]);
  const rooms = Array.isArray(liveSummary?.rooms) ? liveSummary.rooms : [];
  const liveRoom = rooms.find(r => Number(r.parentUserId) === pid) || rooms[0] || null;
  const config =
    roomConfigs.find(r => Number(r.parent_user_id) === pid) || roomConfigs[0] || null;
  const radius =
    liveRoom?.radiusMeters != null
      ? Number(liveRoom.radiusMeters)
      : config?.radius_meters != null
        ? Number(config.radius_meters)
        : null;
  return {
    visits,
    currentDistanceMeters: liveRoom?.currentDistanceMeters ?? null,
    currentWithinRadius:
      typeof liveRoom?.isWithinRadius === "boolean" ? liveRoom.isWithinRadius : null,
    currentHeartbeatAt: liveSummary?.currentHeartbeatAt ?? null,
    currentAccuracyMeters: liveSummary?.currentAccuracyMeters ?? null,
    currentRadiusMeters: radius,
    studyRoomName:
      (liveRoom?.name && String(liveRoom.name).trim()) ||
      (config?.name && String(config.name).trim()) ||
      null,
    currentLatitude: liveSummary?.currentLatitude ?? null,
    currentLongitude: liveSummary?.currentLongitude ?? null,
    studyRoomAddress:
      config?.address != null ? String(config.address) : liveRoom?.address ?? null,
    studyRoomLatitude:
      liveRoom?.latitude != null
        ? Number(liveRoom.latitude)
        : config?.latitude != null
          ? Number(config.latitude)
          : null,
    studyRoomLongitude:
      liveRoom?.longitude != null
        ? Number(liveRoom.longitude)
        : config?.longitude != null
          ? Number(config.longitude)
          : null
  };
}

module.exports = {
  APP_ALLOWANCE_MODE_TO_PROFILE_NAME,
  parentLocationRefreshAtByStudentId,
  coachResponseLogSessionId,
  applyCoachSignalFromPreviousTurn,
  insertCoachResponseLogRow,
  coachContextSnapshotFromStudentSnapshot,
  coachContextSnapshotFromTomorrowContext,
  resolveAppAllowanceModeFromProfileName,
  isDaechiRootBulkLockOverride,
  resolveMdmSurfaceModeForParent,
  normalizeModeKey,
  normalizeSimpleMdmProfileName,
  getPatternInsightsCache,
  setPatternInsightsCache,
  buildPatternCacheKey,
  invalidatePatternInsightsCacheForStudent,
  getResponseCache,
  setResponseCache,
  invalidateResponseCacheByPrefix,
  buildParentStudyRoomVisitsCacheKey,
  buildParentStudyRoomVisitsResponse,
  requestStudentAppLocationRefresh,
  getLockStatusCache,
  setLockStatusCache,
  invalidateLockStatusCacheForStudent,
  asyncMapWithConcurrency,
  applyNamedAppAllowanceProfileForStudent,
  ensureBaselineAppAllowanceForStudent,
  buildParentTimedFreeRestoreSnapshot,
  restoreParentAppAllowanceAfterParentFree,
  parseIsoMs,
  getMergedStudyRoomTrackingSummary
};
