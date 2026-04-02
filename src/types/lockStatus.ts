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
