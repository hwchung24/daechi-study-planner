function buildNativeManagedConfig({
  parentUserId,
  studentUserId,
  lockTime,
  serial,
  locked,
  reason
}) {
  return {
    channel: "native_app",
    locked: Boolean(locked),
    managedConfig: {
      serial: serial || null,
      planner_locked: Boolean(locked),
      planner_lock_reason: reason || null,
      planner_lock_time: lockTime,
      parent_user_id: parentUserId,
      student_user_id: studentUserId
    },
    hint: locked
      ? "Managed App Configuration 또는 MDM 앱 고정 정책으로 잠금 상태를 전달합니다."
      : "Managed App Configuration 기준 잠금 상태를 해제합니다."
  };
}

async function applyNativeLockStrategy(context) {
  return buildNativeManagedConfig({ ...context, locked: true });
}

async function clearNativeLockStrategy(context) {
  return buildNativeManagedConfig({ ...context, locked: false });
}

module.exports = {
  applyNativeLockStrategy,
  clearNativeLockStrategy
};
