import React from "react";
import {
  ClipboardList,
  MapPin,
  Settings,
  Smartphone,
  User,
  UserCircle
} from "lucide-react";
import { setAppPath } from "../../lib/appNavigation";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { ParentStudentRow } from "../../types/parent";
import { PARENT_MDM_SURFACE_LABEL } from "./parentDeviceModeDisplay";
import { ParentStudentSelector } from "./ParentStudentSelector";
import { useParentDeviceControlState } from "./useParentDeviceControlState";
import { useParentStudyRoomLive } from "./useParentStudyRoomLive";

type ParentHomeTabProps = {
  apiBase: string;
  authToken: string | null;
  userEmail: string | null;
  parentStudents: ParentStudentRow[];
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  selectedStudent: ParentStudentRow | null;
  parentLockStatus: ParentLockStatus | null;
  notificationUnreadCount: number;
  hapticSelection: () => void;
};

function formatHeartbeatKo(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function mapsUrlForLatLng(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function ParentHomeTab(props: ParentHomeTabProps) {
  const {
    apiBase,
    authToken,
    userEmail,
    parentStudents,
    parentStudentId,
    setParentStudentId,
    selectedStudent,
    parentLockStatus,
    notificationUnreadCount,
    hapticSelection
  } = props;

  const displayName =
    String(userEmail || "")
      .trim()
      .split("@")[0] || "학부모";
  const linked = parentStudents.length > 0;

  const studentId = selectedStudent?.id ?? null;

  const { studyRoomVisitsLoading, studyRoomLiveStatus, hasStudyRoomConfig, displayDistanceMeters } =
    useParentStudyRoomLive({
      apiBase,
      authToken,
      studentId,
      hasStudyRoomSettingHint: Boolean(selectedStudent?.studyRoom)
    });

  const { loading: deviceLoading, snapshot: deviceSnapshot } = useParentDeviceControlState({
    apiBase,
    authToken,
    studentId
  });

  const surfaceLabel = deviceSnapshot
    ? PARENT_MDM_SURFACE_LABEL[deviceSnapshot.displaySurfaceMode] ??
      PARENT_MDM_SURFACE_LABEL.default
    : null;

  const go = (path: string) => {
    hapticSelection();
    setAppPath(path);
  };

  const pickStudent = (id: number | null) => {
    hapticSelection();
    setParentStudentId(id);
  };

  const slat = studyRoomLiveStatus.currentLatitude;
  const slng = studyRoomLiveStatus.currentLongitude;
  const hasStudentCoords =
    slat != null &&
    slng != null &&
    Number.isFinite(Number(slat)) &&
    Number.isFinite(Number(slng));
  const studentLat = hasStudentCoords ? Number(slat) : null;
  const studentLng = hasStudentCoords ? Number(slng) : null;

  const rlat = studyRoomLiveStatus.studyRoomLatitude;
  const rlng = studyRoomLiveStatus.studyRoomLongitude;
  const hasRoomCoords =
    rlat != null &&
    rlng != null &&
    Number.isFinite(Number(rlat)) &&
    Number.isFinite(Number(rlng));

  const roomAddress =
    (studyRoomLiveStatus.studyRoomAddress && studyRoomLiveStatus.studyRoomAddress.trim()) ||
    (selectedStudent?.studyRoom?.address && String(selectedStudent.studyRoom.address).trim()) ||
    "";

  const roomName =
    (studyRoomLiveStatus.studyRoomName && String(studyRoomLiveStatus.studyRoomName).trim()) ||
    (selectedStudent?.studyRoom?.name && String(selectedStudent.studyRoom.name).trim()) ||
    "";

  const distanceMeta =
    hasStudyRoomConfig && displayDistanceMeters != null
      ? `${studyRoomLiveStatus.currentDistanceMeters != null ? "독서실까지" : "독서실까지(최근)"} 약 ${Math.round(displayDistanceMeters)}m${
          typeof studyRoomLiveStatus.currentWithinRadius === "boolean"
            ? ` · ${studyRoomLiveStatus.currentWithinRadius ? "반경 안" : "반경 밖"}`
            : ""
        }`
      : hasStudyRoomConfig && studyRoomVisitsLoading && displayDistanceMeters == null
        ? "독서실까지 거리를 계산하는 중입니다."
        : null;

  const allowanceExtra =
    deviceSnapshot?.activeAppAllowanceMode === "utility"
      ? "유틸리티 허용 구간이 켜져 있을 수 있어요."
      : deviceSnapshot?.activeAppAllowanceMode === "free"
        ? "자유시간 허용 구간이 켜져 있을 수 있어요."
        : null;

  return (
    <div className="coach-page coach-page--manage parent-home">
      <section className="section parent-home__hero">
        <p className="parent-home__eyebrow">대치루트 학부모</p>
        <h2 className="parent-home__title">안녕하세요, {displayName}님</h2>
        <p className="parent-home__lead">
          {linked
            ? "연결된 자녀의 위치·휴대폰 모드를 확인하고 아래 바로가기로 이동할 수 있어요."
            : "자녀 계정과 연결하면 계획·기록·알림을 함께 볼 수 있어요."}
        </p>
        {!linked ? (
          <button
            type="button"
            className="modal-primary parent-home__primary"
            onClick={() => go("#/parent/profile")}
          >
            학생 연결하기
          </button>
        ) : null}
      </section>

      {linked ? (
        <section className="section parent-home__live" aria-label="자녀 실시간 상태">
          <div className="section-header">
            <h3 className="section-title">자녀 선택 · 실시간 상태</h3>
          </div>
          <ParentStudentSelector
            parentStudents={parentStudents}
            parentStudentId={parentStudentId}
            setParentStudentId={pickStudent}
          />
          {selectedStudent ? (
            <div className="parent-home__status-grid">
              <div className="parent-home__status-card">
                <div className="parent-home__status-card-head">
                  <MapPin size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">실시간 위치</span>
                </div>
                {studyRoomVisitsLoading && !hasStudentCoords ? (
                  <p className="parent-home__status-body">마지막 위치를 불러오는 중입니다.</p>
                ) : hasStudentCoords && studentLat != null && studentLng != null ? (
                  <>
                    <p className="parent-home__status-kicker">학생 기기 마지막 보고 (WGS84)</p>
                    <p className="parent-home__status-body parent-home__coords-line">
                      위도 {studentLat.toFixed(6)}°, 경도 {studentLng.toFixed(6)}°
                    </p>
                    <p className="parent-home__status-meta">
                      <a
                        href={mapsUrlForLatLng(studentLat, studentLng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="parent-home__map-link"
                      >
                        지도에서 보기
                      </a>
                      {studyRoomLiveStatus.currentAccuracyMeters != null &&
                      Number.isFinite(Number(studyRoomLiveStatus.currentAccuracyMeters)) ? (
                        <span>
                          {" "}
                          · 오차 약 {Math.round(Number(studyRoomLiveStatus.currentAccuracyMeters))}m
                        </span>
                      ) : null}
                    </p>
                  </>
                ) : !hasStudyRoomConfig && !studyRoomLiveStatus.studyRoomName ? (
                  <p className="parent-home__status-body">
                    독서실 위치가 등록되지 않았습니다. 자녀 설정에서 등록하면 거리·좌표를 함께 볼 수
                    있어요.
                  </p>
                ) : (
                  <p className="parent-home__status-body">
                    아직 좌표가 없습니다. 학생 앱을 켜 두고 위치 권한을 허용하면 마지막 보고 위치가
                    표시됩니다.
                  </p>
                )}
                {distanceMeta ? (
                  <p className="parent-home__status-meta parent-home__status-meta--strong">{distanceMeta}</p>
                ) : null}
                {studyRoomLiveStatus.currentHeartbeatAt ? (
                  <p className="parent-home__status-meta">
                    위치 기준 시각 {formatHeartbeatKo(studyRoomLiveStatus.currentHeartbeatAt)}
                  </p>
                ) : null}
                {roomAddress ? (
                  <p className="parent-home__status-meta">등록 독서실 주소: {roomAddress}</p>
                ) : roomName ? (
                  <p className="parent-home__status-meta">등록 독서실: {roomName}</p>
                ) : null}
                {hasRoomCoords && rlat != null && rlng != null ? (
                  <p className="parent-home__status-meta">
                    <a
                      href={mapsUrlForLatLng(Number(rlat), Number(rlng))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="parent-home__map-link"
                    >
                      독서실 기준점 지도
                    </a>
                  </p>
                ) : null}
              </div>
              <div className="parent-home__status-card">
                <div className="parent-home__status-card-head">
                  <Smartphone size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">휴대폰 모드</span>
                </div>
                {deviceLoading && !deviceSnapshot ? (
                  <p className="parent-home__status-body">기기 상태를 불러오는 중입니다.</p>
                ) : deviceSnapshot && surfaceLabel != null ? (
                  <>
                    <p className="parent-home__status-body">
                      현재 <span className="parent-home__status-em">{surfaceLabel}</span> 모드입니다.
                    </p>
                    {deviceSnapshot.kioskEnabled ? (
                      <p className="parent-home__status-meta">
                        <span className="parent-home__status-em">계획표</span> 작성(키오스크) 시간대일 수
                        있어요.
                      </p>
                    ) : null}
                    {allowanceExtra ? <p className="parent-home__status-meta">{allowanceExtra}</p> : null}
                    {parentLockStatus?.locked ? (
                      <p className="parent-home__status-meta parent-home__status-meta--warn">
                        계획표·시간 잠금이 적용된 상태입니다.
                      </p>
                    ) : null}
                    {selectedStudent.mdmApplied === false ? (
                      <p className="parent-home__status-meta">
                        기기 MDM이 아직 연결되지 않았다면 표시가 지연되거나 비어 있을 수 있어요.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="parent-home__status-body">기기 상태를 가져오지 못했습니다.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="parent-home__status-hint">표시할 학생을 선택해 주세요.</p>
          )}
        </section>
      ) : null}

      <section className="section parent-home__shortcuts">
        <div className="section-header">
          <h3 className="section-title">바로가기</h3>
        </div>
        <div className="parent-home__grid">
          <button
            type="button"
            className="progress-card parent-home__tile"
            onClick={() => go("#/parent/manage")}
            disabled={!linked}
          >
            <User size={22} strokeWidth={2} aria-hidden />
            <span className="parent-home__tile-label">자녀</span>
            <span className="parent-home__tile-hint">관리·채널</span>
          </button>
          <button
            type="button"
            className="progress-card parent-home__tile"
            onClick={() => go("#/parent/records")}
            disabled={!linked}
          >
            <ClipboardList size={22} strokeWidth={2} aria-hidden />
            <span className="parent-home__tile-label">기록</span>
            <span className="parent-home__tile-hint">주간 학습</span>
          </button>
          <button
            type="button"
            className="progress-card parent-home__tile"
            onClick={() => go("#/parent/student-settings")}
            disabled={!linked}
          >
            <Settings size={22} strokeWidth={2} aria-hidden />
            <span className="parent-home__tile-label">자녀 설정</span>
            <span className="parent-home__tile-hint">플래너·앱</span>
          </button>
          <button
            type="button"
            className="progress-card parent-home__tile"
            onClick={() => go("#/parent/profile")}
          >
            <UserCircle size={22} strokeWidth={2} aria-hidden />
            <span className="parent-home__tile-label">내 정보</span>
            <span className="parent-home__tile-hint">
              {notificationUnreadCount > 0
                ? `읽지 않은 알림 ${notificationUnreadCount}건`
                : "계정·알림 설정"}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
