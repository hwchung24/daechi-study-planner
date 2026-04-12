const crypto = require("crypto");

const {
  getActiveDeviceSerialForUser,
  getStudentMdmGroup,
  upsertStudentMdmGroup,
  getStudentMdmKioskProfileState,
  upsertStudentMdmKioskProfileState,
  deleteStudentMdmKioskProfileState,
  setStudentMdmKioskProfileSyncError
} = require("./db");
const {
  isSimpleMdmConfigured,
  findDeviceBySerial,
  createAssignmentGroup,
  assignDeviceToGroup,
  createCustomConfigurationProfile,
  updateCustomConfigurationProfile,
  deleteCustomConfigurationProfile,
  assignProfileToGroup,
  unassignProfileFromGroup,
  syncProfiles
} = require("./simpleMdmClient");

const DAECHI_ROOT_BUNDLE_ID = "com.daechiroot.ios";

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
    const assignmentGroup = await ensureStudentAssignmentGroup(userId, Number(device.id));
    const mobileconfig = buildKioskMobileconfig({
      userId,
      bundleId: String(options.bundleId || DAECHI_ROOT_BUNDLE_ID)
    });
    const profile = await upsertKioskProfile(userId, kioskState, mobileconfig);

    await assignProfileToGroup(assignmentGroup.id, profile.profileId);
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
    await upsertStudentMdmKioskProfileState(userId, {
      profileId: profile.profileId,
      profileName: profile.profileName,
      profileIdentifier: profile.profileIdentifier,
      lockedBundleId: String(options.bundleId || DAECHI_ROOT_BUNDLE_ID),
      lastSyncedAt: new Date().toISOString(),
      lastError
    });

    return {
      ok: true,
      queued: syncDeferred,
      bundleId: String(options.bundleId || DAECHI_ROOT_BUNDLE_ID),
      profileId: profile.profileId,
      assignmentGroupId: assignmentGroup.id,
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
    if (!kioskState?.profile_id) {
      await deleteStudentMdmKioskProfileState(userId).catch(() => {});
      return { ok: true, removed: false, reason: "profile_not_found" };
    }
    const assignmentGroup = await getStudentMdmGroup(userId).catch(() => null);
    const profileId = Number(kioskState.profile_id || 0);
    const assignmentGroupId = Number(assignmentGroup?.assignment_group_id || 0);
    if (assignmentGroupId > 0 && profileId > 0) {
      await unassignProfileFromGroup(assignmentGroupId, profileId).catch(() => {});
      await syncProfiles(assignmentGroupId).catch(() => {});
    }
    if (profileId > 0) {
      await deleteCustomConfigurationProfile(profileId).catch(() => {});
    }
    await deleteStudentMdmKioskProfileState(userId).catch(() => {});
    return {
      ok: true,
      removed: true,
      profileId,
      assignmentGroupId: assignmentGroupId > 0 ? assignmentGroupId : null,
      reason: "removed"
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

module.exports = {
  DAECHI_ROOT_BUNDLE_ID,
  enableStudentKioskMode,
  disableStudentKioskMode
};