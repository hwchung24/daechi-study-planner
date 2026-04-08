export type ParentStudyRoomSetting = {
  studentId: number;
  studentEmail: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  updatedAt: string;
};

export type ParentStudentRow = {
  id: number;
  email: string;
  studyRoom?: ParentStudyRoomSetting | null;
};