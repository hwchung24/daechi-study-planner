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
  currentHeartbeatAt: string | null;
  currentAccuracyMeters: number | null;
  /** 학생 앱·MDM에서 마지막으로 보고된 좌표 (WGS84) */
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  rooms: Array<{
    id: number;
    parentUserId: number;
    parentEmail: string;
    name: string;
    address?: string | null;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    updatedAt: string | null;
    currentDistanceMeters: number | null;
    isWithinRadius: boolean | null;
  }>;
  recentVisits: StudyRoomVisitSession[];
};