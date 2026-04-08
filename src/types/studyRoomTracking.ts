export type StudyRoomVisitSession = {
  id: number;
  parentUserId: number;
  studentUserId: number;
  studyRoomId: number | null;
  studyRoomName: string;
  parentEmail: string;
  enteredAt: string;
  lastSeenAt: string;
  exitedAt: string | null;
  exitReason: string | null;
  lastDistanceMeters: number | null;
};

export type StudentStudyRoomSummary = {
  rooms: Array<{
    id: number;
    parentUserId: number;
    parentEmail: string;
    name: string;
    address?: string | null;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    updatedAt: string;
  }>;
  recentVisits: StudyRoomVisitSession[];
};