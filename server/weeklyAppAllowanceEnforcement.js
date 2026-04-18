const crypto = require("crypto");

const {
  listStudentWeeklyAppAllowanceSlots,
  getActiveDeviceSerialForUser,
  getStudentMdmGroup,
  upsertStudentMdmGroup,
  getStudentMdmAppAllowanceProfileState,
  upsertStudentMdmAppAllowanceProfileState,
  deleteStudentMdmAppAllowanceProfileState,
  setStudentMdmAppAllowanceProfileSyncError,
  listStudentIdsForWeeklyAppAllowanceEnforcement
} = require("./db");
const {
  isSimpleMdmConfigured,
  findDeviceBySerial,
  listInstalledAppsForDevice,
  createAssignmentGroup,
  assignDeviceToGroup,
  createCustomConfigurationProfile,
  updateCustomConfigurationProfile,
  deleteCustomConfigurationProfile,
  assignProfileToGroup,
  unassignProfileFromGroup,
  syncProfiles,
  listProfilesForAssignmentGroup
} = require("./simpleMdmClient");

const SEOUL_TIME_ZONE = "Asia/Seoul";
const SEOUL_WEEKDAY_TO_KEY = {
  sun: "sun",
  mon: "mon",
  tue: "tue",
  wed: "wed",
  thu: "thu",
  fri: "fri",
  sat: "sat"
};
const DAECHI_ROOT_BUNDLE_ID = "com.daechiroot.ios";
const BASELINE_ALLOWLIST_BUNDLE_IDS = Array.from(
  new Set(
    [
      DAECHI_ROOT_BUNDLE_ID,
      ...String(process.env.SIMPLEMDM_APP_ALLOWANCE_BASELINE_BUNDLE_IDS || "")
        .split(",")
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    ].filter(Boolean)
  )
).sort();

function normalizeBundleIds(bundleIds) {
  return Array.from(
    new Set(
      (Array.isArray(bundleIds) ? bundleIds : [])
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort();
}

function hhmmToMinutes(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "24:00") return 24 * 60;
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function getSeoulContext(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    weekday: "short"
  })
    .format(now)
    .toLowerCase();
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: SEOUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
  return {
    dayKey: SEOUL_WEEKDAY_TO_KEY[weekday] || null,
    time,
    minutes: hhmmToMinutes(time)
  };
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function looksLikeBundleId(value) {
  return /^[a-z0-9]+([.-][a-z0-9]+)+$/i.test(String(value || "").trim());
}

function buildInstalledAppLookup(installedApps) {
  const byBundleId = new Map();
  const byName = new Map();
  const byId = new Map();
  for (const app of Array.isArray(installedApps) ? installedApps : []) {
    const bundleId = normalizeLookupText(app?.bundleId);
    const name = normalizeLookupText(app?.name);
    const id = normalizeLookupText(app?.id);
    if (bundleId && !byBundleId.has(bundleId)) {
      byBundleId.set(bundleId, bundleId);
    }
    if (name && bundleId && !byName.has(name)) {
      byName.set(name, bundleId);
    }
    if (id && bundleId && !byId.has(id)) {
      byId.set(id, bundleId);
    }
  }
  byId.set(DAECHI_ROOT_BUNDLE_ID, DAECHI_ROOT_BUNDLE_ID);
  byBundleId.set(DAECHI_ROOT_BUNDLE_ID, DAECHI_ROOT_BUNDLE_ID);
  byName.set("대치루트", DAECHI_ROOT_BUNDLE_ID);
  return { byBundleId, byName, byId };
}

function resolveAllowedBundleId(app, lookup) {
  const bundleId = normalizeLookupText(app?.bundleId);
  if (bundleId) {
    return lookup.byBundleId.get(bundleId) || bundleId;
  }

  const id = normalizeLookupText(app?.id || app?.app_key);
  if (id) {
    if (lookup.byId.has(id)) return lookup.byId.get(id);
    if (looksLikeBundleId(id)) return id;
  }

  const name = normalizeLookupText(app?.name);
  if (name && lookup.byName.has(name)) {
    return lookup.byName.get(name);
  }

  return null;
}

function computeEffectiveAllowedBundleIds(rows, installedApps, context) {
  const effective = new Set(BASELINE_ALLOWLIST_BUNDLE_IDS);
  if (!context.dayKey || context.minutes == null) {
    return Array.from(effective).sort();
  }

  const lookup = buildInstalledAppLookup(installedApps);
  for (const row of Array.isArray(rows) ? rows : []) {
    const dayKey = normalizeLookupText(row?.weekday_key);
    if (dayKey !== context.dayKey) continue;
    const startMinutes = hhmmToMinutes(row?.start_time);
    const endMinutes = hhmmToMinutes(row?.end_time);
    if (startMinutes == null || endMinutes == null) continue;
    if (context.minutes < startMinutes || context.minutes >= endMinutes) continue;
    for (const app of Array.isArray(row?.allowed_apps) ? row.allowed_apps : []) {
      const resolved = resolveAllowedBundleId(app, lookup);
      if (resolved) effective.add(resolved);
    }
  }

  return Array.from(effective).sort();
}

function getOverrideBundleIds(profileState) {
  const bundleIds = normalizeBundleIds(profileState?.override_bundle_ids);
  return bundleIds.length > 0 ? bundleIds : null;
}

function buildPayloadHash(bundleIds) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(Array.isArray(bundleIds) ? bundleIds : []))
    .digest("hex");
}

function normalizeAllowanceModeProfileName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** SimpleMDM에 올라가는 기본/유틸/자유 이름 프로파일(env와 동일 규칙) */
function getConfiguredNamedAllowanceProfileNameSet() {
  return new Set(
    [
      String(process.env.SIMPLEMDM_APP_ALLOWANCE_DEFAULT_PROFILE || "default").trim(),
      String(process.env.SIMPLEMDM_APP_ALLOWANCE_UTILITY_PROFILE || "utility").trim(),
      String(process.env.SIMPLEMDM_APP_ALLOWANCE_FREE_PROFILE || "free").trim()
    ]
      .map(normalizeAllowanceModeProfileName)
      .filter(Boolean)
  );
}

function isDaechiRootBulkLockOverrideBundleIds(overrideBundleIds) {
  const ids = normalizeBundleIds(Array.isArray(overrideBundleIds) ? overrideBundleIds : []);
  return ids.length === 1 && ids[0] === DAECHI_ROOT_BUNDLE_ID.toLowerCase();
}

async function hasUtilityOrFreeNamedProfileAssigned(groupId) {
  const utilityKey = normalizeAllowanceModeProfileName(
    process.env.SIMPLEMDM_APP_ALLOWANCE_UTILITY_PROFILE || "utility"
  );
  const freeKey = normalizeAllowanceModeProfileName(
    process.env.SIMPLEMDM_APP_ALLOWANCE_FREE_PROFILE || "free"
  );
  const assigned = await listProfilesForAssignmentGroup(groupId).catch(() => []);
  for (const profile of Array.isArray(assigned) ? assigned : []) {
    const key = normalizeAllowanceModeProfileName(profile?.attributes?.name);
    if (key === utilityKey || key === freeKey) return true;
  }
  return false;
}

/** 주간 동적 프로파일 적용 전 이름 기반 default/utility/free 제거 */
async function unassignAllNamedAppAllowanceProfilesFromGroup(groupId) {
  const named = getConfiguredNamedAllowanceProfileNameSet();
  const assigned = await listProfilesForAssignmentGroup(groupId).catch(() => []);
  for (const profile of Array.isArray(assigned) ? assigned : []) {
    const profileId = Number(profile?.id);
    const key = normalizeAllowanceModeProfileName(profile?.attributes?.name);
    if (!profileId || !named.has(key)) continue;
    await unassignProfileFromGroup(groupId, profileId).catch(() => {});
  }
  await syncProfiles(groupId).catch(() => {});
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRestrictionsMobileconfig({ userId, bundleIds }) {
  const identifier = `com.daechiroot.weekly-app-allowance.${userId}`;
  const restrictionIdentifier = `${identifier}.restrictions`;
  const payloadUuid = crypto.randomUUID();
  const restrictionUuid = crypto.randomUUID();
  const items = Array.isArray(bundleIds) ? bundleIds : [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.applicationaccess</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadIdentifier</key>
      <string>${escapeXml(restrictionIdentifier)}</string>
      <key>PayloadUUID</key>
      <string>${escapeXml(restrictionUuid)}</string>
      <key>PayloadDisplayName</key>
      <string>DaechiRoot Weekly App Allowance</string>
      <key>allowListedAppBundleIDs</key>
      <array>
${items.map(bundleId => `        <string>${escapeXml(bundleId)}</string>`).join("\n")}
      </array>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>DaechiRoot Weekly App Allowance</string>
  <key>PayloadIdentifier</key>
  <string>${escapeXml(identifier)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${escapeXml(payloadUuid)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
}

async function ensureStudentAssignmentGroup(userId, deviceId) {
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

async function upsertProfileForStudent(userId, profileState, mobileconfig) {
  const profileName = `DaechiRoot Weekly App Allowance ${userId}`;
  const currentProfileId = Number(profileState?.profile_id || 0);

  if (currentProfileId > 0) {
    try {
      const updated = await updateCustomConfigurationProfile(currentProfileId, {
        name: profileName,
        mobileconfig,
        userScope: false,
        attributeSupport: false,
        declarative: false
      });
      if (updated?.id) {
        return {
          profileId: Number(updated.id),
          profileName: updated.attributes?.name || profileName,
          profileIdentifier:
            updated.attributes?.profile_identifier ||
            profileState?.profile_identifier ||
            null,
          replacedProfileId: null
        };
      }
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
  }

  const created = await createCustomConfigurationProfile({
    name: profileName,
    mobileconfig,
    userScope: false,
    attributeSupport: false,
    declarative: false
  });
  if (!created?.id) {
    throw new Error("학생용 SimpleMDM restriction profile 생성에 실패했습니다.");
  }

  return {
    profileId: Number(created.id),
    profileName: created.attributes?.name || profileName,
    profileIdentifier: created.attributes?.profile_identifier || null,
    replacedProfileId: currentProfileId > 0 ? currentProfileId : null
  };
}

async function syncStudentWeeklyAppAllowance(userId, options = {}) {
  if (!isSimpleMdmConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "simplemdm_not_configured"
    };
  }

  let bundleIds = [];
  let deviceId = null;
  let assignmentGroupId = null;
  let profileId = null;
  let appliedRemotely = false;

  try {
    const serial = await getActiveDeviceSerialForUser(userId);
    if (!serial) {
      const error = "연결된 학생 기기가 없습니다.";
      await setStudentMdmAppAllowanceProfileSyncError(userId, error);
      return { ok: false, skipped: true, reason: "device_not_linked", error };
    }

    const device = await findDeviceBySerial(serial);
    if (!device?.id) {
      const error = "SimpleMDM에서 학생 기기를 찾지 못했습니다.";
      await setStudentMdmAppAllowanceProfileSyncError(userId, error);
      return { ok: false, skipped: true, reason: "device_not_found", error };
    }

    const [rows, profileState] = await Promise.all([
      listStudentWeeklyAppAllowanceSlots(userId),
      getStudentMdmAppAllowanceProfileState(userId)
    ]);
    const installedApps = await listInstalledAppsForDevice(Number(device.id)).catch(() => []);
    const context = getSeoulContext(options.now || new Date());
    const bundleIds =
      getOverrideBundleIds(profileState) ||
      computeEffectiveAllowedBundleIds(rows, installedApps, context);
    const payloadHash = buildPayloadHash(bundleIds);

    if (
      !options.force &&
      profileState?.last_payload_hash === payloadHash &&
      !profileState?.last_error
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "unchanged",
        bundleIds,
        deviceId: Number(device.id)
      };
    }

    const assignmentGroup = await ensureStudentAssignmentGroup(userId, Number(device.id));

    // 유틸/자유 이름 프로파일이 켜져 있으면 주간 동기화로 덮어쓰지 않음(일괄잠금 override 적용 시에는 제외)
    const namedUtilityOrFreeBlocksWeekly =
      (await hasUtilityOrFreeNamedProfileAssigned(assignmentGroup.id)) &&
      !options.force &&
      !isDaechiRootBulkLockOverrideBundleIds(profileState?.override_bundle_ids);
    if (namedUtilityOrFreeBlocksWeekly) {
      return {
        ok: true,
        skipped: true,
        reason: "named_utility_or_free_active",
        bundleIds,
        deviceId: Number(device.id)
      };
    }

    await unassignAllNamedAppAllowanceProfilesFromGroup(assignmentGroup.id);

    const mobileconfig = buildRestrictionsMobileconfig({ userId, bundleIds });
    const profile = await upsertProfileForStudent(userId, profileState, mobileconfig);
    deviceId = Number(device.id);
    assignmentGroupId = assignmentGroup.id;
    profileId = profile.profileId;

    await assignProfileToGroup(assignmentGroup.id, profile.profileId);
    appliedRemotely = true;

    if (
      profile.replacedProfileId &&
      Number(profile.replacedProfileId) > 0 &&
      Number(profile.replacedProfileId) !== Number(profile.profileId)
    ) {
      await unassignProfileFromGroup(assignmentGroup.id, profile.replacedProfileId).catch(() => {});
      await deleteCustomConfigurationProfile(profile.replacedProfileId).catch(() => {});
    }

    let syncDeferred = false;
    try {
      await syncProfiles(assignmentGroup.id);
    } catch (error) {
      if (error?.status === 429) {
        syncDeferred = true;
      } else {
        throw error;
      }
    }

    const lastError = syncDeferred
      ? "SimpleMDM sync_profiles rate limit으로 다음 주기에 재시도합니다."
      : null;
    await upsertStudentMdmAppAllowanceProfileState(userId, {
      profileId: profile.profileId,
      profileName: profile.profileName,
      profileIdentifier: profile.profileIdentifier,
      lastPayloadHash: payloadHash,
      lastSyncedAt: new Date().toISOString(),
      lastError
    });

    return {
      ok: true,
      queued: syncDeferred,
      bundleIds,
      overrideApplied: Array.isArray(profileState?.override_bundle_ids),
      payloadHash,
      deviceId,
      assignmentGroupId,
      profileId,
      reason: syncDeferred ? "rate_limited" : options.reason || "manual"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "허용 앱 제한 동기화에 실패했습니다.";
    await setStudentMdmAppAllowanceProfileSyncError(userId, message).catch(() => {});
    if (appliedRemotely) {
      return {
        ok: true,
        partial: true,
        warning: message,
        bundleIds,
        appliedRemotely: true,
        deviceId,
        assignmentGroupId,
        profileId,
        reason: "applied_with_warning"
      };
    }
    return {
      ok: false,
      error: message,
      reason: "sync_failed"
    };
  }
}

async function reconcileAllStudentWeeklyAppAllowances(options = {}) {
  if (!isSimpleMdmConfigured()) {
    return {
      processed: 0,
      changed: 0,
      failed: 0,
      skipped: 0,
      reason: "simplemdm_not_configured"
    };
  }

  const userIds = await listStudentIdsForWeeklyAppAllowanceEnforcement();
  let changed = 0;
  let failed = 0;
  let skipped = 0;

  for (const userId of userIds) {
    const result = await syncStudentWeeklyAppAllowance(userId, {
      reason: options.reason || "cron",
      force: Boolean(options.force),
      now: options.now
    });
    if (result.ok && !result.skipped) {
      changed += 1;
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    failed += 1;
  }

  return {
    processed: userIds.length,
    changed,
    failed,
    skipped
  };
}

async function removeStudentWeeklyAppAllowanceRestriction(userId) {
  const profileState = await getStudentMdmAppAllowanceProfileState(userId);
  if (!profileState?.profile_id) {
    await deleteStudentMdmAppAllowanceProfileState(userId).catch(() => {});
    return {
      ok: true,
      removed: false,
      reason: "profile_not_found"
    };
  }

  const assignmentGroup = await getStudentMdmGroup(userId).catch(() => null);
  const profileId = Number(profileState.profile_id || 0);
  const assignmentGroupId = Number(assignmentGroup?.assignment_group_id || 0);

  if (assignmentGroupId > 0 && profileId > 0) {
    await unassignProfileFromGroup(assignmentGroupId, profileId).catch(() => {});
    await syncProfiles(assignmentGroupId).catch(() => {});
  }
  if (profileId > 0) {
    await deleteCustomConfigurationProfile(profileId).catch(() => {});
  }
  await deleteStudentMdmAppAllowanceProfileState(userId).catch(() => {});

  return {
    ok: true,
    removed: true,
    profileId,
    assignmentGroupId: assignmentGroupId > 0 ? assignmentGroupId : null,
    reason: "removed"
  };
}

module.exports = {
  syncStudentWeeklyAppAllowance,
  reconcileAllStudentWeeklyAppAllowances,
  removeStudentWeeklyAppAllowanceRestriction
};