export type StudentLockRule = {
  parentUserId: number;
  enabled: boolean;
  lockTime: string;
  desiredLocked: boolean;
  reason: string;
  tomorrowSubmitted: boolean;
  scheduledFor: string;
};

export type StudentLockStatus = {
  locked: boolean;
  reason: string;
  timezone: string;
  todayKey: string;
  tomorrowKey: string;
  kioskMode?: {
    active: boolean;
    profileId?: number | null;
    lockedBundleId?: string | null;
    activationSource?: "planner_time" | "admin_manual" | "manual" | null;
    autoReleaseExempt?: boolean;
    lastSyncedAt?: string | null;
    lastError?: string | null;
  };
  dailyRecordCompletion?: {
    completed?: boolean;
    study_saved_at?: string | null;
    life_saved_at?: string | null;
  };
  forceRecordsPage?: boolean;
  rules: StudentLockRule[];
  sessions: Array<{
    id: number;
    status: string;
    reason?: string | null;
    locked_at?: string | null;
    unlocked_at?: string | null;
  }>;
};

export type ParentLockStatus = {
  locked: boolean;
  timezone: string;
  rule?: StudentLockRule | null;
  session?: {
    id: number;
    status: string;
    reason?: string | null;
    locked_at?: string | null;
    unlocked_at?: string | null;
  } | null;
};
