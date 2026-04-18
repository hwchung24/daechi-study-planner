export type ParentStudyRoomSetting = {
  studentId: number;
  studentEmail: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  updatedAt: string;
};

export type ParentStudentRow = {
  id: number;
  email: string;
  /** 서버 `student_coach_profiles.mdm_applied` — 기기 연결·MDM 연동 여부 */
  mdmApplied?: boolean;
  studyRoom?: ParentStudyRoomSetting | null;
};

export type ParentCoachCustomization = {
  persona: string;
  tone: string;
  controlIntensity: number;
  focusRules: string;
  updatedAt?: string | null;
};