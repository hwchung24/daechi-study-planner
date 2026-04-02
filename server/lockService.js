const {
  listPlannerRulesForStudent,
  listAllPlannerRules,
  getLatestPlannerLockSession,
  listLatestPlannerLockSessionsForStudent,
  createPlannerLockSession,
  updatePlannerLockSession,
  hasStudyPlanContentForDate,
  getActiveDeviceSerialForUser
} = require("./db");
const {
  applyWebLockStrategy,
  clearWebLockStrategy
} = require("./lockStrategies/webLockStrategy");
const {
  applyNativeLockStrategy,
  clearNativeLockStrategy
} = require("./lockStrategies/nativeLockStrategy");

const LOCK_TIMEZONE = "Asia/Seoul";

function formatDateInKst(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatTimeInKst(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LOCK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function nextDateKey(dateKey) {
  const [y, m, d] = String(dateKey || "")
    .split("-")
    .map(Number);
  const next = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function parseLockClock(lockTime) {
  const safe = /^\d{2}:\d{2}$/.test(String(lockTime || "")) ? lockTime : "21:00";
  const [hour, minute] = safe.split(":").map(Number);
  return { safe, hour, minute };
}

function buildScheduledForIso(dateKey, lockTime) {
  const { hour, minute } = parseLockClock(lockTime);
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map(Number);
  const utcMs = Date.UTC(
    year,
    Math.max((month || 1) - 1, 0),
    day || 1,
    hour - 9,
    minute,
    0,
    0
  );
  return new Date(utcMs).toISOString();
}

function mergeMdmPayloads(webPayload, nativePayload) {
  return {
    webview: webPayload,
    native_app: nativePayload
  };
}

async function buildStrategyPayloads(rule, locked, reason) {
  const serial = await getActiveDeviceSerialForUser(rule.student_user_id);
  const context = {
    webAppUrl: process.env.WEB_APP_URL || "http://localhost:5173",
    parentUserId: rule.parent_user_id,
    studentUserId: rule.student_user_id,
    lockTime: rule.lock_time,
    serial,
    reason
  };
  const webPayload = locked
    ? await applyWebLockStrategy(context)
    : await clearWebLockStrategy(context);
  const nativePayload = locked
    ? await applyNativeLockStrategy(context)
    : await clearNativeLockStrategy(context);
  return mergeMdmPayloads(webPayload, nativePayload);
}

async function evaluateRule(rule, now = new Date()) {
  const todayKey = formatDateInKst(now);
  const tomorrowKey = nextDateKey(todayKey);
  const nowTime = formatTimeInKst(now);
  const lockTime = parseLockClock(rule.lock_time).safe;
  const tomorrowSubmitted = await hasStudyPlanContentForDate(
    rule.student_user_id,
    tomorrowKey
  );

  if (!rule.enabled) {
    return {
      desiredLocked: false,
      reason: "rule_disabled",
      todayKey,
      tomorrowKey,
      lockTime,
      nowTime,
      tomorrowSubmitted,
      scheduledFor: buildScheduledForIso(todayKey, lockTime)
    };
  }

  if (nowTime < lockTime) {
    return {
      desiredLocked: false,
      reason: "before_lock_time",
      todayKey,
      tomorrowKey,
      lockTime,
      nowTime,
      tomorrowSubmitted,
      scheduledFor: buildScheduledForIso(todayKey, lockTime)
    };
  }

  if (tomorrowSubmitted) {
    return {
      desiredLocked: false,
      reason: "tomorrow_plan_submitted",
      todayKey,
      tomorrowKey,
      lockTime,
      nowTime,
      tomorrowSubmitted,
      scheduledFor: buildScheduledForIso(todayKey, lockTime)
    };
  }

  return {
    desiredLocked: true,
    reason: "waiting_for_tomorrow_plan",
    todayKey,
    tomorrowKey,
    lockTime,
    nowTime,
    tomorrowSubmitted,
    scheduledFor: buildScheduledForIso(todayKey, lockTime)
  };
}

async function reconcileRule(rule, now = new Date()) {
  const latest = await getLatestPlannerLockSession(
    rule.parent_user_id,
    rule.student_user_id
  );
  let evaluation = await evaluateRule(rule, now);
  const todayKey = formatDateInKst(now);
  const latestKey = latest?.updated_at
    ? formatDateInKst(new Date(latest.updated_at))
    : null;
  if (latest && latestKey === todayKey) {
    if (latest.reason === "manual_parent_unlock") {
      evaluation = {
        ...evaluation,
        desiredLocked: false,
        reason: "manual_parent_unlock"
      };
    } else if (latest.reason === "manual_parent_lock") {
      evaluation = {
        ...evaluation,
        desiredLocked: true,
        reason: "manual_parent_lock"
      };
    }
  }
  const mdmPayload = await buildStrategyPayloads(
    rule,
    evaluation.desiredLocked,
    evaluation.reason
  );

  if (!latest) {
    const created = await createPlannerLockSession({
      parentUserId: rule.parent_user_id,
      studentUserId: rule.student_user_id,
      deviceLinkMode: "unknown",
      provider: "simplemdm",
      scheduledFor: evaluation.scheduledFor,
      lockedAt: evaluation.desiredLocked ? now.toISOString() : null,
      unlockedAt: evaluation.desiredLocked ? null : now.toISOString(),
      status: evaluation.desiredLocked ? "locked" : "unlocked",
      reason: evaluation.reason,
      mdmPayload
    });
    return { rule, evaluation, session: created, changed: true };
  }

  const currentlyLocked = latest.status === "locked" && !latest.unlocked_at;
  if (currentlyLocked === evaluation.desiredLocked) {
    const updated = await updatePlannerLockSession(latest.id, {
      scheduledFor: evaluation.scheduledFor,
      reason: evaluation.reason,
      mdmPayload
    });
    return { rule, evaluation, session: updated || latest, changed: false };
  }

  const updated = await updatePlannerLockSession(latest.id, {
    scheduledFor: evaluation.scheduledFor,
    lockedAt: evaluation.desiredLocked ? now.toISOString() : latest.locked_at,
    unlockedAt: evaluation.desiredLocked ? null : now.toISOString(),
    status: evaluation.desiredLocked ? "locked" : "unlocked",
    reason: evaluation.reason,
    mdmPayload
  });
  return { rule, evaluation, session: updated || latest, changed: true };
}

async function getStudentLockStatus(studentUserId, now = new Date()) {
  const rules = await listPlannerRulesForStudent(studentUserId);
  if (rules.length === 0) {
    return {
      locked: false,
      reason: "no_parent_rule",
      timezone: LOCK_TIMEZONE,
      todayKey: formatDateInKst(now),
      tomorrowKey: nextDateKey(formatDateInKst(now)),
      rules: [],
      sessions: []
    };
  }

  const reconciled = [];
  for (const rule of rules) {
    reconciled.push(await reconcileRule(rule, now));
  }
  const lockedRules = reconciled.filter(item => item.evaluation.desiredLocked);
  const sessions = await listLatestPlannerLockSessionsForStudent(studentUserId);

  return {
    locked: lockedRules.length > 0,
    reason: lockedRules[0]?.evaluation.reason || "unlocked",
    timezone: LOCK_TIMEZONE,
    todayKey: reconciled[0]?.evaluation.todayKey || formatDateInKst(now),
    tomorrowKey:
      reconciled[0]?.evaluation.tomorrowKey ||
      nextDateKey(formatDateInKst(now)),
    rules: reconciled.map(item => ({
      parentUserId: item.rule.parent_user_id,
      enabled: Boolean(item.rule.enabled),
      lockTime: item.evaluation.lockTime,
      desiredLocked: item.evaluation.desiredLocked,
      reason: item.evaluation.reason,
      tomorrowSubmitted: item.evaluation.tomorrowSubmitted,
      scheduledFor: item.evaluation.scheduledFor
    })),
    sessions
  };
}

async function assertStudentCanEditDate(studentUserId, date) {
  const status = await getStudentLockStatus(studentUserId);
  if (!status.locked) return { ok: true, status };
  if (String(date || "") === status.tomorrowKey) {
    return { ok: true, status };
  }
  return { ok: false, status };
}

async function forceParentLock(parentUserId, studentUserId) {
  const rule = {
    parent_user_id: parentUserId,
    student_user_id: studentUserId,
    enabled: true,
    lock_time: formatTimeInKst(new Date())
  };
  const mdmPayload = await buildStrategyPayloads(
    rule,
    true,
    "manual_parent_lock"
  );
  const latest = await getLatestPlannerLockSession(parentUserId, studentUserId);
  if (!latest) {
    return createPlannerLockSession({
      parentUserId,
      studentUserId,
      deviceLinkMode: "unknown",
      provider: "simplemdm",
      scheduledFor: new Date().toISOString(),
      lockedAt: new Date().toISOString(),
      unlockedAt: null,
      status: "locked",
      reason: "manual_parent_lock",
      mdmPayload
    });
  }
  return updatePlannerLockSession(latest.id, {
    status: "locked",
    reason: "manual_parent_lock",
    scheduledFor: new Date().toISOString(),
    lockedAt: new Date().toISOString(),
    unlockedAt: null,
    mdmPayload
  });
}

async function forceParentUnlock(parentUserId, studentUserId) {
  const rule = {
    parent_user_id: parentUserId,
    student_user_id: studentUserId,
    enabled: true,
    lock_time: formatTimeInKst(new Date())
  };
  const mdmPayload = await buildStrategyPayloads(
    rule,
    false,
    "manual_parent_unlock"
  );
  const latest = await getLatestPlannerLockSession(parentUserId, studentUserId);
  if (!latest) {
    return createPlannerLockSession({
      parentUserId,
      studentUserId,
      deviceLinkMode: "unknown",
      provider: "simplemdm",
      scheduledFor: new Date().toISOString(),
      lockedAt: null,
      unlockedAt: new Date().toISOString(),
      status: "unlocked",
      reason: "manual_parent_unlock",
      mdmPayload
    });
  }
  return updatePlannerLockSession(latest.id, {
    status: "unlocked",
    reason: "manual_parent_unlock",
    scheduledFor: new Date().toISOString(),
    unlockedAt: new Date().toISOString(),
    mdmPayload
  });
}

async function getParentLockStatus(parentUserId, studentUserId, now = new Date()) {
  const status = await getStudentLockStatus(studentUserId, now);
  const session = await getLatestPlannerLockSession(parentUserId, studentUserId);
  const matchingRule = status.rules.find(
    rule => Number(rule.parentUserId) === Number(parentUserId)
  );
  return {
    locked: Boolean(matchingRule?.desiredLocked),
    session: session || null,
    rule: matchingRule || null,
    timezone: LOCK_TIMEZONE
  };
}

async function reconcileAllPlannerLocks(now = new Date()) {
  const rules = await listAllPlannerRules();
  const results = [];
  for (const rule of rules) {
    results.push(await reconcileRule(rule, now));
  }
  return {
    evaluated: results.length,
    changed: results.filter(item => item.changed).length
  };
}

module.exports = {
  LOCK_TIMEZONE,
  formatDateInKst,
  formatTimeInKst,
  getStudentLockStatus,
  assertStudentCanEditDate,
  forceParentLock,
  forceParentUnlock,
  getParentLockStatus,
  reconcileAllPlannerLocks
};
