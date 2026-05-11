import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, MapPin, Smartphone } from "lucide-react";
import { setAppPath } from "../../lib/appNavigation";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { ParentStudentRow } from "../../types/parent";
import { StudyRoomPickerModal, type StudyRoomSetting } from "../../components/parent/StudyRoomPickerModal";
import { TimePickerSheet } from "../../components/TimePickerSheet";
import { DAECHI_LINKS_UPDATED_EVENT } from "../../lib/linkEvents";
import { getDateKeySeoul, seoulDateKeyFromApiValue } from "../../lib/weekDates";
import { ParentStudentSelector } from "./ParentStudentSelector";
import {
  type ParentSimpleMdmNetworkStatus,
  useParentDeviceControlState
} from "./useParentDeviceControlState";
import { useParentStudyRoomLive } from "./useParentStudyRoomLive";

type ParentHomeTabProps = {
  apiBase: string;
  authToken: string | null;
  userEmail: string | null;
  parentStudents: ParentStudentRow[];
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  selectedStudent: ParentStudentRow | null;
  parentReport: ParentHomeReport | null;
  suggestedPhrase?: string | null;
  suggestedPhraseLoading?: boolean;
  parentLockStatus: ParentLockStatus | null;
  notificationUnreadCount: number;
  hapticSelection: () => void;
};

type ParentHomeReport = {
  days?: Array<{ id: number | string; date: string }>;
  blocks?: Array<{
    study_day_id: number | string;
    subject: string;
    start_time: string;
    end_time: string;
  }>;
};

function timeToMinutes(value: string) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getSeoulMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const hh = Number(parts.find(part => part.type === "hour")?.value ?? NaN);
  const mm = Number(parts.find(part => part.type === "minute")?.value ?? NaN);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function formatSimpleMdmAgePhraseKo(ageMinutes: number) {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return "";
  if (ageMinutes <= 1) return "1분 이내";
  if (ageMinutes < 60) return `약 ${ageMinutes}분 전`;
  if (ageMinutes < 1440) return `약 ${Math.floor(ageMinutes / 60)}시간 전`;
  return `약 ${Math.floor(ageMinutes / 1440)}일 전`;
}

/** MDM last_seen 기준 경과(문장에 그대로 넣기 좋은 짧은 구) */
function formatSimpleMdmLastContactDetail(net: ParentSimpleMdmNetworkStatus) {
  const sec = net.lastSeenAgeSeconds;
  if (sec != null && Number.isFinite(sec) && sec >= 0) {
    if (sec < 20) return "20초 이내";
    if (sec < 60) return `약 ${sec}초 전`;
    if (sec < 120) return "약 1분 전";
  }
  const m = net.ageMinutes;
  if (m != null && Number.isFinite(m)) {
    return formatSimpleMdmAgePhraseKo(m);
  }
  return "";
}

function simpleMdmNetworkDescription(opts: {
  net: ParentSimpleMdmNetworkStatus;
}): string | null {
  const { net } = opts;
  if (!net.available) {
    if (net.status !== "skipped") return null;
    const r = net.skippedReason || "";
    if (r === "simplemdm_not_configured") {
      return "Simple MDM(API)가 서버에 연결되어 있지 않아, 기기 네트워크(통신) 상태는 여기서 확인할 수 없어요.";
    }
    if (r === "no_active_device_serial") {
      return "학생 계정에 등록된 활성 기기 시리얼이 없어 Simple MDM으로 네트워크 여부를 확인할 수 없어요.";
    }
    if (r === "device_not_in_simplemdm") {
      return "Simple MDM에 해당 기기가 보이지 않습니다. 기기 등록·동기화를 확인해 주세요.";
    }
    if (r === "simplemdm_rate_limited") {
      return "Simple MDM 요청이 잠시 제한되어 연결 상태를 가져오지 못했습니다. 잠시 후 다시 열어 주세요.";
    }
    if (r === "simplemdm_error") {
      return "Simple MDM 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    }
    return null;
  }
  if (net.status === "recent") {
    const detail = formatSimpleMdmLastContactDetail(net);
    const carrier = net.carrierNetwork ? ` (통신사: ${net.carrierNetwork})` : "";
    const head = detail
      ? `MDM 서버와 마지막으로 통신한 시점은 ${detail}입니다.${carrier}`
      : `MDM 서버와의 통신 시각이 아주 최근입니다.${carrier}`;
    return `${head} Wi-Fi·데이터를 끈 뒤에도 이 시각은 잠시 멈춰 있을 수 있어, 지금 이 순간 온라인인지는 여기서 확정할 수 없습니다.`;
  }
  if (net.status === "stale") {
    const detail = formatSimpleMdmLastContactDetail(net);
    return detail
      ? `마지막 MDM 통신은 ${detail}입니다. 네트워크를 끈 뒤라면 더 이상 갱신되지 않을 수 있어요.`
      : "마지막 MDM 통신 시각이 오래되었습니다. 기기 전원·네트워크를 확인해 보세요.";
  }
  if (net.status === "unknown") {
    return "Simple MDM에 기기는 있으나 마지막 통신 시각을 확인하지 못했습니다.";
  }
  return null;
}

export function ParentHomeTab(props: ParentHomeTabProps) {
  const {
    apiBase,
    authToken,
    parentStudents,
    parentStudentId,
    setParentStudentId,
    selectedStudent,
    parentReport,
    suggestedPhrase,
    suggestedPhraseLoading,
    parentLockStatus,
    hapticSelection
  } = props;

  const linked = parentStudents.length > 0;

  const studentId = selectedStudent?.id ?? null;

  const [studyRoomModalOpen, setStudyRoomModalOpen] = useState(false);
  const [studyRoomSaving, setStudyRoomSaving] = useState(false);
  const [freeModeToggling, setFreeModeToggling] = useState(false);
  const [plannerEnabled, setPlannerEnabled] = useState(false);
  const [plannerTime, setPlannerTime] = useState("21:00");
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerSaving, setPlannerSaving] = useState(false);
  const [plannerTimeSheetOpen, setPlannerTimeSheetOpen] = useState(false);
  const [delayedNetConnected, setDelayedNetConnected] = useState<boolean | null>(null);
  const [showNoLinkedHint, setShowNoLinkedHint] = useState(false);

  const { studyRoomVisitsLoading, studyRoomLiveStatus, hasStudyRoomConfig } =
    useParentStudyRoomLive({
      apiBase,
      authToken,
      studentId,
      hasStudyRoomSettingHint: Boolean(selectedStudent?.studyRoom)
    });

  const {
    loading: deviceLoading,
    snapshot: deviceSnapshot,
    refresh: refreshDeviceSnapshot
  } = useParentDeviceControlState({
    apiBase,
    authToken,
    studentId
  });

  const simpleMdmNet = deviceSnapshot?.simpleMdmNetwork ?? null;

  const pickStudent = (id: number | null) => {
    hapticSelection();
    setParentStudentId(id);
  };

  const goParent = (path: string) => {
    hapticSelection();
    setAppPath(path);
  };

  const saveStudyRoomSetting = (value: StudyRoomSetting) => {
    if (!authToken) return;
    setStudyRoomSaving(true);
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/parent/students/${encodeURIComponent(String(value.studentId))}/study-room`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({
              name: value.name,
              address: value.address || null,
              latitude: value.latitude,
              longitude: value.longitude,
              radiusMeters: value.radiusMeters
            })
          }
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(String(data.error || "독서실 위치 저장에 실패했습니다."));
        }
        setStudyRoomModalOpen(false);
        window.dispatchEvent(new Event(DAECHI_LINKS_UPDATED_EVENT));
      } catch (error) {
        alert(
          error instanceof Error && error.message
            ? error.message
            : "독서실 위치 저장 중 오류가 발생했습니다."
        );
      } finally {
        setStudyRoomSaving(false);
      }
    })();
  };

  useEffect(() => {
    if (!authToken || !selectedStudent?.id) {
      setPlannerEnabled(false);
      setPlannerTime("21:00");
      setPlannerLoading(false);
      setPlannerSaving(false);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setPlannerLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/parent/planner-rule?studentId=${encodeURIComponent(String(selectedStudent.id))}`,
          { signal: ac.signal, headers: { Authorization: `Bearer ${authToken}` }, cache: "no-store" }
        );
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          rule?: { enabled?: boolean; lockTime?: string };
        };
        if (!res.ok) throw new Error(String(data.error || "설정 정보를 불러오지 못했습니다."));
        if (cancelled) return;
        setPlannerEnabled(Boolean(data.rule?.enabled));
        setPlannerTime(String(data.rule?.lockTime || "21:00").slice(0, 5));
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        // keep defaults on error
      } finally {
        if (!cancelled) setPlannerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [apiBase, authToken, selectedStudent?.id]);

  const savePlannerRule = async (next: { enabled: boolean; lockTime: string }) => {
    if (!authToken || !selectedStudent?.id) return;
    setPlannerSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/parent/planner-rule`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          enabled: next.enabled,
          lockTime: next.lockTime
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        rule?: { enabled?: boolean; lockTime?: string };
      };
      if (!res.ok) throw new Error(String(data.error || "설정 저장에 실패했습니다."));
      setPlannerEnabled(Boolean(data.rule?.enabled));
      setPlannerTime(String(data.rule?.lockTime || next.lockTime).slice(0, 5));
    } catch (error) {
      alert(
        error instanceof Error && error.message
          ? error.message
          : "설정 저장 중 오류가 발생했습니다."
      );
    } finally {
      setPlannerSaving(false);
    }
  };

  const togglePlannerEnabled = async () => {
    if (!authToken || !selectedStudent?.id || plannerSaving) return;
    hapticSelection();
    const nextEnabled = !plannerEnabled;
    setPlannerEnabled(nextEnabled);
    await savePlannerRule({ enabled: nextEnabled, lockTime: plannerTime });
  };

  const toggleFreeMode = () => {
    if (!authToken || !selectedStudent?.id || freeModeToggling) return;
    const isFree = deviceSnapshot?.activeAppAllowanceMode === "free";
    setFreeModeToggling(true);
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/parent/app-allowance/activate-mode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            mode: isFree ? "default" : "free",
            studentIds: [selectedStudent.id]
          })
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; ok?: boolean };
        if (!res.ok || data.ok === false) {
          throw new Error(String(data.error || data.message || "자유시간 모드 변경에 실패했습니다."));
        }
        await refreshDeviceSnapshot();
      } catch (error) {
        alert(
          error instanceof Error && error.message
            ? error.message
            : "자유시간 모드 변경 중 오류가 발생했습니다."
        );
      } finally {
        setFreeModeToggling(false);
      }
    })();
  };

  const phoneModeLabel = deviceSnapshot
    ? deviceSnapshot.displaySurfaceMode === "block"
      ? "차단"
      : deviceSnapshot.activeAppAllowanceMode === "free"
        ? "자유"
        : deviceSnapshot.activeAppAllowanceMode === "utility"
          ? "유틸"
          : "기본"
    : null;
  const plannerKioskModeActive = Boolean(selectedStudent?.kioskActive);

  const netConnected =
    deviceSnapshot?.simpleMdmNetwork?.status === "recent";

  useEffect(() => {
    if (linked) {
      setShowNoLinkedHint(false);
      return;
    }
    setShowNoLinkedHint(false);
    const timer = window.setTimeout(() => {
      setShowNoLinkedHint(true);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [linked]);

  useEffect(() => {
    if (!selectedStudent?.id) {
      setDelayedNetConnected(null);
      return;
    }
    if (deviceLoading && !deviceSnapshot) {
      setDelayedNetConnected(null);
      return;
    }
    if (!deviceSnapshot) {
      setDelayedNetConnected(false);
      return;
    }
    if (netConnected) {
      setDelayedNetConnected(true);
      return;
    }
    setDelayedNetConnected(false);
  }, [deviceLoading, deviceSnapshot, netConnected, selectedStudent?.id]);

  const reportReady = parentReport !== null;

  const currentTimelineStudy = useMemo(() => {
    const days = Array.isArray(parentReport?.days) ? parentReport.days : [];
    const blocks = Array.isArray(parentReport?.blocks) ? parentReport.blocks : [];
    if (days.length === 0 || blocks.length === 0) return null;

    const todayKey = getDateKeySeoul(0);
    const todayDay = days.find(day => seoulDateKeyFromApiValue(day.date) === todayKey);
    if (!todayDay) return null;

    const nowMinutes = getSeoulMinutesNow();
    if (nowMinutes == null) return null;

    const todayBlocks = blocks.filter(
      block => Number(block.study_day_id) === Number(todayDay.id)
    );
    if (todayBlocks.length === 0) return null;

    const currentBlock =
      todayBlocks.find(block => {
        const start = timeToMinutes(block.start_time);
        const end = timeToMinutes(block.end_time);
        if (start == null || end == null) return false;
        return nowMinutes >= start && nowMinutes < end;
      }) || null;

    if (!currentBlock) return null;
    return String(currentBlock.subject || "").trim() || "과목 미설정";
  }, [parentReport]);

  return (
    <div className="coach-page parent-home">
      {!linked ? (
        <section className="section parent-home__live" aria-label="자녀 실시간 상태">
          {showNoLinkedHint ? (
            <p className="parent-home__status-hint">
              연결된 자녀가 없습니다. 상단 메뉴에서 학생을 연결해 주세요.
            </p>
          ) : (
            null
          )}
        </section>
      ) : (
        <section className="section parent-home__live" aria-label="자녀 실시간 상태">
          {selectedStudent ? (
            <>
              <div className="parent-home__coach-phrase-card">
                {!suggestedPhraseLoading && String(suggestedPhrase || "").trim() ? (
                  <p className="parent-home__coach-phrase parent-home__coach-phrase--fade">
                    {String(suggestedPhrase || "").trim()}
                  </p>
                ) : null}
              </div>
              <div className="parent-home__coach-phrase-card parent-home__coach-phrase-card--sub">
                {delayedNetConnected == null ? (
                  null
                ) : (
                  <p className="parent-home__coach-phrase parent-home__coach-phrase--sub parent-home__coach-phrase--fade">
                    {delayedNetConnected ? "연결됨" : "연결 끊김"}
                  </p>
                )}
              </div>
              <div className="parent-home__status-grid">
                <div className="parent-home__status-card">
                <div className="parent-home__status-card-head">
                  <MapPin size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">실시간 위치</span>
                </div>
                <div className="parent-home__status-center">
                  {!hasStudyRoomConfig ? (
                    <p className="parent-home__status-body parent-home__status-body--fade">독서실 미등록</p>
                  ) : typeof studyRoomLiveStatus.currentWithinRadius === "boolean" ? (
                    <p className="parent-home__status-body parent-home__status-body--fade">
                      {studyRoomLiveStatus.currentWithinRadius ? "체크인" : "체크아웃"}
                    </p>
                  ) : studyRoomVisitsLoading ? (
                    null
                  ) : (
                    <p className="parent-home__status-body parent-home__status-body--fade">상태 없음</p>
                  )}
                </div>
                <div className="parent-home__status-card-footer">
                  <button
                    type="button"
                    className="timeline-save-button study-room-editor__save-button parent-home__status-action"
                    onClick={() => {
                      hapticSelection();
                      setStudyRoomModalOpen(true);
                    }}
                    disabled={!selectedStudent || studyRoomSaving}
                  >
                    독서실 설정
                  </button>
                </div>
              </div>
              <div className="parent-home__status-card">
                <div className="parent-home__status-card-head">
                  <Smartphone size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">휴대폰 모드</span>
                </div>
                {deviceLoading && !deviceSnapshot ? (
                  <div className="parent-home__status-center">
                    null
                  </div>
                ) : deviceSnapshot ? (
                  <div className="parent-home__status-center">
                    <p className="parent-home__status-body parent-home__status-body--fade">
                      {phoneModeLabel ? (
                        <span className="parent-home__status-em">
                          {phoneModeLabel}
                          {plannerKioskModeActive ? " · 계획표" : ""}
                        </span>
                      ) : (
                        "모드 정보를 불러오지 못했습니다."
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="parent-home__status-center">
                    <p className="parent-home__status-body parent-home__status-body--fade">기기 상태를 가져오지 못했습니다.</p>
                  </div>
                )}
                <div className="parent-home__status-card-footer">
                  <button
                    type="button"
                    className="timeline-save-button study-room-editor__save-button parent-home__status-action"
                    onClick={() => {
                      hapticSelection();
                      toggleFreeMode();
                    }}
                    disabled={!selectedStudent?.id || !authToken || freeModeToggling}
                    aria-busy={freeModeToggling}
                  >
                    {deviceSnapshot?.activeAppAllowanceMode === "free" ? "자유 끄기" : "자유시간 주기"}
                  </button>
                </div>
              </div>
              <div className="parent-home__status-card" aria-label="계획표 카드">
                <div className="parent-home__status-card-head">
                  <CalendarDays size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">계획표</span>
                  {!plannerLoading ? (
                    <button
                      type="button"
                      className="parent-home__planner-now-toggle"
                      onClick={() => void togglePlannerEnabled()}
                      disabled={plannerSaving || !selectedStudent?.id || !authToken}
                      aria-pressed={plannerEnabled}
                      aria-label={plannerEnabled ? "지금 끄기" : "지금 켜기"}
                      aria-busy={plannerSaving}
                    >
                      {plannerEnabled ? "지금 끄기" : "지금 켜기"}
                    </button>
                  ) : null}
                </div>
                {plannerLoading ? (
                  <div className="parent-home__status-center">
                    null
                  </div>
                ) : (
                  <>
                    <div className="parent-home__status-center">
                      <button
                        type="button"
                        className="parent-home__status-time-btn"
                        disabled={!plannerEnabled || plannerSaving}
                        onClick={() => setPlannerTimeSheetOpen(true)}
                        aria-label="계획표 시간 설정"
                      >
                        {plannerTime}
                      </button>
                    </div>
                    <TimePickerSheet
                      open={plannerTimeSheetOpen}
                      value={plannerTime}
                      onClose={() => setPlannerTimeSheetOpen(false)}
                      onSave={async (newTime: string) => {
                        setPlannerTimeSheetOpen(false);
                        setPlannerTime(newTime);
                        await savePlannerRule({ enabled: plannerEnabled, lockTime: newTime });
                      }}
                      disabled={!plannerEnabled || plannerSaving}
                    />
                    <div className="parent-home__status-card-footer parent-home__status-card-footer--stack">
                      <button
                        type="button"
                        className={
                          "timeline-save-button study-room-editor__save-button parent-home__status-action" +
                          (!plannerEnabled ? " parent-home__status-action--muted" : "")
                        }
                        onClick={() => void togglePlannerEnabled()}
                        aria-pressed={plannerEnabled}
                        aria-label={plannerEnabled ? "시간 설정 해제" : "시간 설정"}
                        disabled={plannerSaving}
                        aria-busy={plannerSaving}
                      >
                        {plannerEnabled ? "시간 설정 해제" : "시간 설정"}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="parent-home__status-card" aria-label="현재 공부 내용 카드">
                <div className="parent-home__status-card-head">
                  <BookOpen size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">현재 공부</span>
                </div>
                <div className="parent-home__status-center">
                  {reportReady ? (
                    <p className="parent-home__status-body parent-home__status-body--fade">
                      {currentTimelineStudy || "설정 안됨"}
                    </p>
                  ) : (
                    null
                  )}
                </div>
                <div className="parent-home__status-card-footer">
                  <button
                    type="button"
                    className="timeline-save-button study-room-editor__save-button parent-home__status-action"
                    onClick={() => goParent("#/parent/records")}
                  >
                    학습 보기
                  </button>
                </div>
                </div>
              </div>
            </>
          ) : (
            <p className="parent-home__status-hint">표시할 학생을 선택해 주세요.</p>
          )}
        </section>
      )}
      <StudyRoomPickerModal
        open={studyRoomModalOpen}
        student={selectedStudent ? { id: selectedStudent.id, email: selectedStudent.email } : null}
        initialValue={selectedStudent?.studyRoom || undefined}
        authToken={authToken}
        saving={studyRoomSaving}
        onClose={() => setStudyRoomModalOpen(false)}
        onSave={saveStudyRoomSetting}
      />
    </div>
  );
}
