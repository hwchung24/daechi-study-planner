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

export type ParentMdmSurfaceKey = "bulk_lock" | "schedule" | "utility" | "free" | "default";

export type ParentStudentRow = {
  id: number;
  email: string;
  /** 서버 `student_coach_profiles.mdm_applied` — 기기 연결·MDM 연동 여부 */
  mdmApplied?: boolean;
  /** `student_mdm_app_allowance_profiles.ui_surface_mode` — 허용앱 표면 모드 스냅샷 */
  appAllowanceSurface?: ParentMdmSurfaceKey | string | null;
  /** `student_mdm_kiosk_profiles.profile_id` 존재 여부 — 키오스크(계획표 실행) */
  kioskActive?: boolean;
  studyRoom?: ParentStudyRoomSetting | null;
};

export type ParentCoachCustomization = {
  persona: string;
  tone: string;
  controlIntensity: number;
  focusRules: string;
  updatedAt?: string | null;
};