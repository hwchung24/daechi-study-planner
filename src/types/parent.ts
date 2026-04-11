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
  studyRoom?: ParentStudyRoomSetting | null;
};

export type ParentCoachCustomization = {
  persona: string;
  tone: string;
  controlIntensity: number;
  focusRules: string;
  updatedAt?: string | null;
};