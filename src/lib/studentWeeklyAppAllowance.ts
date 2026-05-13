export type WeeklyAppAllowanceCandidate = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  bundleId?: string | null;
};

export type WeeklyAppAllowanceDayKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export type WeeklyAppAllowanceSlot = {
  id: string;
  dayKey: WeeklyAppAllowanceDayKey;
  startTime: string;
  endTime: string;
  allowedApps: WeeklyAppAllowanceCandidate[];
};

export type WeeklyAppAllowanceSchedule = Record<
  WeeklyAppAllowanceDayKey,
  WeeklyAppAllowanceSlot[]
>;

export const WEEKLY_APP_ALLOWANCE_DAYS: Array<{
  key: WeeklyAppAllowanceDayKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "mon", label: "월요일", shortLabel: "월" },
  { key: "tue", label: "화요일", shortLabel: "화" },
  { key: "wed", label: "수요일", shortLabel: "수" },
  { key: "thu", label: "목요일", shortLabel: "목" },
  { key: "fri", label: "금요일", shortLabel: "금" },
  { key: "sat", label: "토요일", shortLabel: "토" },
  { key: "sun", label: "일요일", shortLabel: "일" }
];

export const DAECHI_ROOT_APP_ID = "com.daechiroot.ios";
export const DAECHI_ROOT_APP_NAME = "대치루트";
export const DAECHI_ROOT_WEEKLY_APP: WeeklyAppAllowanceCandidate = {
  id: DAECHI_ROOT_APP_ID,
  name: DAECHI_ROOT_APP_NAME,
  category: "필수 앱",
  description: "대치루트 앱은 항상 허용됩니다.",
  bundleId: DAECHI_ROOT_APP_ID
};

let weeklyAppAllowanceSequence = 0;

export function createWeeklyAppAllowanceSlotId() {
  weeklyAppAllowanceSequence += 1;
  return `weekly-app-allowance-slot-${weeklyAppAllowanceSequence}`;
}

export function hhmmToMinutesAllow24(value: string): number | null {
  const trimmed = String(value || "").trim();
  if (trimmed === "24:00") return 24 * 60;
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function minutesToHhmmAllow24(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  if (clamped >= 24 * 60) return "24:00";
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function sanitizeWeeklyAppAllowanceTime(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (trimmed === "24:00") return trimmed;
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

export function isDaechiRootWeeklyApp(
  app: WeeklyAppAllowanceCandidate | null | undefined
) {
  const id = String(app?.id || "").trim().toLowerCase();
  const bundleId = String(app?.bundleId || "").trim().toLowerCase();
  const name = String(app?.name || "").trim();
  return id === DAECHI_ROOT_APP_ID || bundleId === DAECHI_ROOT_APP_ID || name === DAECHI_ROOT_APP_NAME;
}

export function normalizeWeeklyAppAllowanceCandidates(
  rows: WeeklyAppAllowanceCandidate[]
): WeeklyAppAllowanceCandidate[] {
  const seen = new Set<string>();
  const next = (rows || []).filter(app => {
    const id = String(app?.id || "").trim();
    const name = String(app?.name || "").trim();
    if (!id || !name) return false;
    const key = `${id}::${name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!next.some(isDaechiRootWeeklyApp)) {
    next.unshift({ ...DAECHI_ROOT_WEEKLY_APP });
  }
  return next;
}

export function ensureDaechiRootWeeklyApps(
  rows: WeeklyAppAllowanceCandidate[]
): WeeklyAppAllowanceCandidate[] {
  const normalized = normalizeWeeklyAppAllowanceCandidates(rows);
  const root = normalized.find(isDaechiRootWeeklyApp) || { ...DAECHI_ROOT_WEEKLY_APP };
  const others = normalized.filter(app => !isDaechiRootWeeklyApp(app));
  return [root, ...others];
}

export function sortWeeklyAppAllowanceSlots(
  slots: WeeklyAppAllowanceSlot[]
): WeeklyAppAllowanceSlot[] {
  return [...slots].sort((a, b) => {
    const aMin = hhmmToMinutesAllow24(a.startTime) ?? Number.MAX_SAFE_INTEGER;
    const bMin = hhmmToMinutesAllow24(b.startTime) ?? Number.MAX_SAFE_INTEGER;
    if (aMin !== bMin) return aMin - bMin;
    const aEnd = hhmmToMinutesAllow24(a.endTime) ?? Number.MAX_SAFE_INTEGER;
    const bEnd = hhmmToMinutesAllow24(b.endTime) ?? Number.MAX_SAFE_INTEGER;
    return aEnd - bEnd;
  });
}

export function createEmptyWeeklyAppAllowanceSchedule(): WeeklyAppAllowanceSchedule {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: []
  };
}

export function createWeeklyAppAllowanceSlot(input: {
  id?: string;
  dayKey: WeeklyAppAllowanceDayKey;
  startTime: string;
  endTime: string;
  allowedApps?: WeeklyAppAllowanceCandidate[];
}): WeeklyAppAllowanceSlot {
  return {
    id: input.id || createWeeklyAppAllowanceSlotId(),
    dayKey: input.dayKey,
    startTime: String(input.startTime || "").trim(),
    endTime: String(input.endTime || "").trim(),
    allowedApps: ensureDaechiRootWeeklyApps(
      Array.isArray(input.allowedApps) ? input.allowedApps : []
    )
  };
}

export function normalizeWeeklyAppAllowanceSchedule(
  raw: Partial<WeeklyAppAllowanceSchedule> | null | undefined
): WeeklyAppAllowanceSchedule {
  const empty = createEmptyWeeklyAppAllowanceSchedule();
  for (const day of WEEKLY_APP_ALLOWANCE_DAYS) {
    const rawDaySlots = raw?.[day.key];
    const source = Array.isArray(rawDaySlots) ? rawDaySlots : [];
    empty[day.key] = sortWeeklyAppAllowanceSlots(
      source
        .map(slot => {
          const startTime = sanitizeWeeklyAppAllowanceTime(String(slot?.startTime || ""));
          const endTime = sanitizeWeeklyAppAllowanceTime(String(slot?.endTime || ""));
          if (!startTime || !endTime) return null;
          const startMinutes = hhmmToMinutesAllow24(startTime);
          const endMinutes = hhmmToMinutesAllow24(endTime);
          if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
            return null;
          }
          return createWeeklyAppAllowanceSlot({
            id: String(slot?.id || "").trim() || undefined,
            dayKey: day.key,
            startTime,
            endTime,
            allowedApps: Array.isArray(slot?.allowedApps) ? slot.allowedApps : []
          });
        })
        .filter((slot): slot is WeeklyAppAllowanceSlot => Boolean(slot))
    );
  }
  return empty;
}