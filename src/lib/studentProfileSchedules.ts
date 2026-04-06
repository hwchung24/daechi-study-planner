export type StudentProfileSchedule = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  source: "manual" | "ai" | string;
  note: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const STUDENT_PROFILE_SCHEDULES_UPDATED_EVENT =
  "daechi:student-profile-schedules-updated";