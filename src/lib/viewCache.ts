type LocalCacheEnvelope<T> = {
  savedAt: number;
  value: T;
};

export type LocalCacheSnapshot<T> = {
  value: T;
  savedAt: number;
  isFresh: boolean;
};

const VIEW_CACHE_PREFIX = "daechi_view_cache";
const USER_EMAIL_STORAGE_KEY = "daechi_planner_user_email";

export function normalizeLocalCacheScope(scope: string | null | undefined): string {
  const normalized = String(scope ?? "").trim().toLowerCase();
  return normalized || "anonymous";
}

export function readStoredUserCacheScope(): string {
  if (typeof window === "undefined") return "anonymous";
  try {
    return normalizeLocalCacheScope(localStorage.getItem(USER_EMAIL_STORAGE_KEY));
  } catch {
    return "anonymous";
  }
}

function buildViewCacheKey(parts: Array<string | number | null | undefined>): string {
  return [
    VIEW_CACHE_PREFIX,
    ...parts
      .map(part => String(part ?? "").trim())
      .filter(part => part.length > 0)
  ].join(":");
}

export function buildStudentCoachStateCacheKey(
  scope: string | null | undefined,
  weekStart: string
): string {
  return buildViewCacheKey(["student-coach-state", normalizeLocalCacheScope(scope), weekStart]);
}

export function buildStudentCoachPatternsCacheKey(
  scope: string | null | undefined,
  weekStart: string
): string {
  return buildViewCacheKey(["student-coach-patterns", normalizeLocalCacheScope(scope), weekStart]);
}

export function buildParentCoachStateCacheKey(
  scope: string | null | undefined,
  studentId: number | null,
  weekStart: string
): string {
  return buildViewCacheKey([
    "parent-coach-state",
    normalizeLocalCacheScope(scope),
    studentId == null ? "no-student" : String(studentId),
    weekStart
  ]);
}

export function buildParentCoachPatternsCacheKey(
  scope: string | null | undefined,
  studentId: number | null,
  weekStart: string
): string {
  return buildViewCacheKey([
    "parent-coach-patterns",
    normalizeLocalCacheScope(scope),
    studentId == null ? "no-student" : String(studentId),
    weekStart
  ]);
}

export function buildStoreAppsCacheKey(scope: string | null | undefined): string {
  return buildViewCacheKey(["student-store-apps", normalizeLocalCacheScope(scope)]);
}

export function readLocalCache<T>(
  key: string,
  maxAgeMs = 0
): LocalCacheSnapshot<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalCacheEnvelope<T>>;
    const savedAt = Number(parsed.savedAt ?? 0);
    if (!Number.isFinite(savedAt) || parsed.value === undefined) {
      return null;
    }
    const ageMs = Date.now() - savedAt;
    return {
      value: parsed.value as T,
      savedAt,
      isFresh: maxAgeMs <= 0 ? true : ageMs <= maxAgeMs
    };
  } catch {
    return null;
  }
}

export function writeLocalCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const payload: LocalCacheEnvelope<T> = {
      savedAt: Date.now(),
      value
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore
  }
}