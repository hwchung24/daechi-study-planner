export type StudentAlarmSettings = {
  scheduleReminders: boolean;
  parentLinkAlerts: boolean;
  studyRoomAlerts: boolean;
  wakeAlarmEnabled: boolean;
  wakeAlarmTime: string;
};

const STUDENT_PROFILE_CACHE_PREFIX = "daechi_student_profile";

export const STUDENT_ALARM_SETTINGS_UPDATED_EVENT =
  "daechi:student-alarm-settings-updated";

export const DEFAULT_STUDENT_ALARM_SETTINGS: StudentAlarmSettings = {
  scheduleReminders: true,
  parentLinkAlerts: true,
  studyRoomAlerts: true,
  wakeAlarmEnabled: false,
  wakeAlarmTime: "06:30"
};

function profileCacheScope(email: string | null) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized || "anonymous";
}

function normalizeWakeAlarmTime(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text)
    ? text
    : DEFAULT_STUDENT_ALARM_SETTINGS.wakeAlarmTime;
}

export function buildStudentAlarmSettingsCacheKey(email: string | null) {
  return `${STUDENT_PROFILE_CACHE_PREFIX}:${profileCacheScope(email)}:alarm-settings`;
}

export function normalizeStudentAlarmSettings(
  raw: Partial<StudentAlarmSettings> | null | undefined
): StudentAlarmSettings {
  return {
    ...DEFAULT_STUDENT_ALARM_SETTINGS,
    ...(raw || {}),
    scheduleReminders:
      raw?.scheduleReminders == null
        ? DEFAULT_STUDENT_ALARM_SETTINGS.scheduleReminders
        : Boolean(raw.scheduleReminders),
    parentLinkAlerts:
      raw?.parentLinkAlerts == null
        ? DEFAULT_STUDENT_ALARM_SETTINGS.parentLinkAlerts
        : Boolean(raw.parentLinkAlerts),
    studyRoomAlerts:
      raw?.studyRoomAlerts == null
        ? DEFAULT_STUDENT_ALARM_SETTINGS.studyRoomAlerts
        : Boolean(raw.studyRoomAlerts),
    wakeAlarmEnabled:
      raw?.wakeAlarmEnabled == null
        ? DEFAULT_STUDENT_ALARM_SETTINGS.wakeAlarmEnabled
        : Boolean(raw.wakeAlarmEnabled),
    wakeAlarmTime: normalizeWakeAlarmTime(raw?.wakeAlarmTime)
  };
}

export function readStudentAlarmSettings(key: string) {
  if (typeof window === "undefined") return DEFAULT_STUDENT_ALARM_SETTINGS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_STUDENT_ALARM_SETTINGS;
    return normalizeStudentAlarmSettings(
      JSON.parse(raw) as Partial<StudentAlarmSettings>
    );
  } catch {
    return DEFAULT_STUDENT_ALARM_SETTINGS;
  }
}

export function writeStudentAlarmSettings(
  key: string,
  value: StudentAlarmSettings
) {
  if (typeof window === "undefined") return;
  const normalized = normalizeStudentAlarmSettings(value);
  try {
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch {
    // ignore
  }
  window.dispatchEvent(
    new CustomEvent(STUDENT_ALARM_SETTINGS_UPDATED_EVENT, {
      detail: {
        key,
        settings: normalized
      }
    })
  );
}