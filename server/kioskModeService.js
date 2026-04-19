const crypto = require("crypto");

const {
  getActiveDeviceSerialForUser,
  getStudentMdmGroup,
  upsertStudentMdmGroup,
  getStudentMdmKioskProfileState,
  upsertStudentMdmKioskProfileState,
  deleteStudentMdmKioskProfileState,
  setStudentMdmKioskProfileSyncError,
  listAllPlannerRules,
  getStudentDailyRecordCompletion,
  upsertStudentCoachProfile
} = require("./db");
const {
  isSimpleMdmConfigured,
  findDeviceBySerial,
  createAssignmentGroup,
  assignDeviceToGroup,
  createCustomConfigurationProfile,
  updateCustomConfigurationProfile,
  assignProfileToGroup,
  unassignProfileFromGroup,
  syncProfiles,
  findDeviceBySerial,
  refreshDevice
} = require("./simpleMdmClient");

const DAECHI_ROOT_BUNDLE_ID = "com.daechiroot.ios";

async function markStudentProfileMdmApplied(userId) {
  await upsertStudentCoachProfile(userId, { mdmApplied: true }).catch(() => {});
}

function normalizeActivationSource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "planner_time") return "planner_time";
  if (normalized === "admin_manual") return "admin_manual";
  return "manual";
}

function formatTimeInKst(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function parseLockClock(lockTime) {
  const safe = /^\d{2}:\d{2}$/.test(String(lockTime || "")) ? String(lockTime) : "21:00";
  return safe;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildKioskMobileconfig({ userId, bundleId }) {
  const identifier = `com.daechiroot.kiosk-mode.${userId}`;
  const payloadUuid = crypto.randomUUID();
  const kioskUuid = crypto.randomUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.app.lock</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadIdentifier</key>
      <string>${escapeXml(`${identifier}.lock`)}</string>
      <key>PayloadUUID</key>
      <string>${escapeXml(kioskUuid)}</string>
      <key>PayloadDisplayName</key>
      <string>DaechiRoot Kiosk Mode</string>
      <key>App</key>
      <dict>
        <key>Identifier</key>
        <string>${escapeXml(bundleId)}</string>
        <key>Options</key>
        <dict>
          <key>DisableAutoLock</key>
          <true/>
          <key>DisableDeviceRotation</key>
          <true/>
          <key>DisableSleepWakeButton</key>
          <true/>
          <key>DisableVolumeButtons</key>
          <true/>
          <key>DisableRingerSwitch</key>
          <true/>
          <key>DisableTouch</key>
          <false/>
        </dict>
      </dict>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>DaechiRoot Kiosk Mode</string>
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

async function upsertKioskProfile(userId, kioskState, mobileconfig) {
  const profileName = `DaechiRoot Kiosk Mode ${userId}`;
  const currentProfileId = Number(kioskState?.profile_id || 0);

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
            updated.attributes?.profile_identifier || kioskState?.profile_identifier || null,
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
    throw new Error("학생용 SimpleMDM 키오스크 프로필 생성에 실패했습니다.");
  }

  return {
    profileId: Number(created.id),
    profileName: created.attributes?.name || profileName,
    profileIdentifier: created.attributes?.profile_identifier || null,
    replacedProfileId: currentProfileId > 0 ? currentProfileId : null
  };
}

async function enableStudentKioskMode(userId, options = {}) {
  if (!isSimpleMdmConfigured()) {
    return { ok: false, skipped: true, reason: "simplemdm_not_configured" };
  }

  try {
    const serial = await getActiveDeviceSerialForUser(userId);
    if (!serial) {
      const error = "연결된 학생 기기가 없습니다.";
      await setStudentMdmKioskProfileSyncError(userId, error);
      return { ok: false, skipped: true, reason: "device_not_linked", error };
    }
    const device = await findDeviceBySerial(serial);
    if (!device?.id) {
      const error = "SimpleMDM에서 학생 기기를 찾지 못했습니다.";
      await setStudentMdmKioskProfileSyncError(userId, error);
      return { ok: false, skipped: true, reason: "device_not_found", error };
    }

    const kioskState = await getStudentMdmKioskProfileState(userId);
    const targetBundleId = String(options.bundleId || DAECHI_ROOT_BUNDLE_ID);
    const activationSource = normalizeActivationSource(options.activationSource || options.reason);
    const autoReleaseExempt = Object.prototype.hasOwnProperty.call(options, "autoReleaseExempt")
      ? Boolean(options.autoReleaseExempt)
      : activationSource === "admin_manual";
    const sourceUnchanged =
      normalizeActivationSource(kioskState?.activation_source) === activationSource;
    const exemptUnchanged =
      Boolean(kioskState?.auto_release_exempt) === autoReleaseExempt;
    if (
      !options.force &&
      kioskState?.profile_id &&
      String(kioskState.locked_bundle_id || "").trim().toLowerCase() ===
        targetBundleId.trim().toLowerCase() &&
      !kioskState.last_error
    ) {
      if (!sourceUnchanged || !exemptUnchanged) {
        await upsertStudentMdmKioskProfileState(userId, {
          profileId: Number(kioskState.profile_id),
          profileName: kioskState.profile_name || null,
          profileIdentifier: kioskState.profile_identifier || null,
          lockedBundleId: targetBundleId,
          activationSource,
          autoReleaseExempt,
          lastSyncedAt: kioskState.last_synced_at || null,
          lastError: null
        });
      }
      await markStudentProfileMdmApplied(userId);
      return {
        ok: true,
        skipped: true,
        reason: !sourceUnchanged || !exemptUnchanged ? "metadata_updated" : "unchanged",
        bundleId: targetBundleId,
        profileId: Number(kioskState.profile_id),
        activationSource,
        autoReleaseExempt
      };
    }
    const assignmentGroup = await ensureStudentAssignmentGroup(userId, Number(device.id));
    const mobileconfig = buildKioskMobileconfig({
      userId,
      bundleId: targetBundleId
    });
    const profile = await upsertKioskProfile(userId, kioskState, mobileconfig);

    await assignProfileToGroup(assignmentGroup.id, profile.profileId);
    if (
      profile.replacedProfileId &&
      Number(profile.replacedProfileId) > 0 &&
      Number(profile.replacedProfileId) !== Number(profile.profileId)
    ) {
      await unassignProfileFromGroup(assignmentGroup.id, profile.replacedProfileId).catch(() => {});
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
    await upsertStudentMdmKioskProfileState(userId, {
      profileId: profile.profileId,
      profileName: profile.profileName,
      profileIdentifier: profile.profileIdentifier,
      lockedBundleId: targetBundleId,
      activationSource,
      autoReleaseExempt,
      lastSyncedAt: new Date().toISOString(),
      lastError
    });
    await markStudentProfileMdmApplied(userId);

    return {
      ok: true,
      queued: syncDeferred,
      bundleId: targetBundleId,
      profileId: profile.profileId,
      assignmentGroupId: assignmentGroup.id,
      activationSource,
      autoReleaseExempt,
      reason: syncDeferred ? "rate_limited" : options.reason || "manual"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "키오스크 모드 적용에 실패했습니다.";
    await setStudentMdmKioskProfileSyncError(userId, message).catch(() => {});
    return {
      ok: false,
      error: message,
      reason: "sync_failed"
    };
  }
}

async function disableStudentKioskMode(userId) {
  if (!isSimpleMdmConfigured()) {
    return { ok: false, skipped: true, reason: "simplemdm_not_configured" };
  }

  try {
    const kioskState = await getStudentMdmKioskProfileState(userId);
    const lockedBundle = String(kioskState?.locked_bundle_id || "").trim();
    if (!kioskState?.profile_id && !lockedBundle) {
      await deleteStudentMdmKioskProfileState(userId).catch(() => {});
      return { ok: true, removed: false, reason: "profile_not_found" };
    }
    /** 이미 해제됨(프로파일 리소스는 Simple MDM에 남겨 재사용) */
    if (!lockedBundle) {
      return {
        ok: true,
        removed: false,
        reason: "already_inactive",
        profileId: kioskState?.profile_id ? Number(kioskState.profile_id) : null
      };
    }
    const assignmentGroup = await getStudentMdmGroup(userId).catch(() => null);
    const profileId = Number(kioskState.profile_id || 0);
    const assignmentGroupId = Number(assignmentGroup?.assignment_group_id || 0);
    if (assignmentGroupId > 0 && profileId > 0) {
      await unassignProfileFromGroup(assignmentGroupId, profileId).catch(() => {});
      await syncProfiles(assignmentGroupId).catch(() => {});
    }
    try {
      const serial = await getActiveDeviceSerialForUser(userId);
      if (serial) {
        const device = await findDeviceBySerial(serial);
        if (device?.id) {
          await refreshDevice(Number(device.id)).catch(() => {});
        }
      }
    } catch {
      // ignore refresh failures
    }
    await upsertStudentMdmKioskProfileState(userId, {
      profileId: profileId > 0 ? profileId : null,
      profileName: kioskState.profile_name != null ? String(kioskState.profile_name) : null,
      profileIdentifier:
        kioskState.profile_identifier != null ? String(kioskState.profile_identifier) : null,
      lockedBundleId: null,
      activationSource: null,
      autoReleaseExempt: false,
      lastSyncedAt: new Date().toISOString(),
      lastError: null
    });
    return {
      ok: true,
      removed: true,
      profileId: profileId > 0 ? profileId : null,
      assignmentGroupId: assignmentGroupId > 0 ? assignmentGroupId : null,
      reason: "unassigned_profile_retained"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "키오스크 모드 해제에 실패했습니다.";
    await setStudentMdmKioskProfileSyncError(userId, message).catch(() => {});
    return {
      ok: false,
      error: message,
      reason: "sync_failed"
    };
  }
}

async function getStudentKioskModeStatus(userId) {
  const state = await getStudentMdmKioskProfileState(userId);
  return {
    active: Boolean(state?.locked_bundle_id && String(state.locked_bundle_id).trim()),
    profileId: state?.profile_id ? Number(state.profile_id) : null,
    lockedBundleId: state?.locked_bundle_id ? String(state.locked_bundle_id) : null,
    activationSource: state?.activation_source
      ? normalizeActivationSource(state.activation_source)
      : null,
    autoReleaseExempt: Boolean(state?.auto_release_exempt),
    lastSyncedAt: state?.last_synced_at || null,
    lastError: state?.last_error ? String(state.last_error) : null
  };
}

async function reconcilePlannerTimeKioskModes(now = new Date()) {
  const rules = await listAllPlannerRules();
  const nowTime = formatTimeInKst(now);
  const desiredLockedByStudent = new Map();

  for (const rule of rules) {
    if (!rule?.enabled) continue;
    const lockTime = parseLockClock(rule.lock_time);
    if (nowTime < lockTime) continue;
    desiredLockedByStudent.set(Number(rule.student_user_id), true);
  }

  let enabled = 0;
  let released = 0;
  let skipped = 0;
  let failed = 0;

  for (const studentUserId of desiredLockedByStudent.keys()) {
    try {
      const completion = await getStudentDailyRecordCompletion(studentUserId);
      if (completion.completed) {
        const disabled = await disableStudentKioskMode(studentUserId);
        if (disabled.ok) {
          released += 1;
        } else {
          failed += 1;
        }
        continue;
      }
      const enabledResult = await enableStudentKioskMode(studentUserId, {
        reason: "planner_time_record_gate",
        activationSource: "planner_time",
        autoReleaseExempt: false
      });
      if (enabledResult.ok && enabledResult.skipped) {
        skipped += 1;
      } else if (enabledResult.ok) {
        enabled += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    evaluatedStudents: desiredLockedByStudent.size,
    enabled,
    released,
    skipped,
    failed
  };
}

module.exports = {
  DAECHI_ROOT_BUNDLE_ID,
  enableStudentKioskMode,
  disableStudentKioskMode,
  getStudentKioskModeStatus,
  reconcilePlannerTimeKioskModes
};