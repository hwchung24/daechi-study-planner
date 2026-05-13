import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, MapPin, Smartphone } from "lucide-react";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { ParentStudentRow } from "../../types/parent";
import { StudyRoomPickerModal, type StudyRoomSetting } from "../../components/parent/StudyRoomPickerModal";
import { TimePickerSheet } from "../../components/TimePickerSheet";
import { DAECHI_LINKS_UPDATED_EVENT } from "../../lib/linkEvents";
import { getDateKeySeoul, seoulDateKeyFromApiValue } from "../../lib/weekDates";
import { ParentStudentSelector } from "./ParentStudentSelector";
import {
  type ParentSimpleMdmNetworkStatus,
  computeParentDeviceControlSnapshot,
  patchParentDeviceSnapshotForAllowanceMode,
  useParentDeviceControlState
} from "./useParentDeviceControlState";
import { useParentStudyRoomLive } from "./useParentStudyRoomLive";
import { useModalReveal } from "../../lib/useModalReveal";
import {
  ParentRecordsWeekSection,
  type ParentWeeklyRecordsReport
} from "./ParentRecordsWeekSection";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const H = ko.parentHomeTab;

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
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
};

type ParentHomeReport = ParentWeeklyRecordsReport;

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

const PARENT_FREE_MINUTE_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

function formatSeoulTimeLabel(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(dt);
}

function formatSimpleMdmAgePhraseKo(ageMinutes: number) {
  const a = H.mdmAge;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return "";
  if (ageMinutes <= 1) return a.within1Min;
  if (ageMinutes < 60) return tpl(a.aboutMinutes, { n: String(Math.floor(ageMinutes)) });
  if (ageMinutes < 1440) return tpl(a.aboutHours, { n: String(Math.floor(ageMinutes / 60)) });
  return tpl(a.aboutDays, { n: String(Math.floor(ageMinutes / 1440)) });
}

/** MDM last_seen 기준 경과(문장에 그대로 넣기 좋은 짧은 구) */
function formatSimpleMdmLastContactDetail(net: ParentSimpleMdmNetworkStatus) {
  const a = H.mdmAge;
  const sec = net.lastSeenAgeSeconds;
  if (sec != null && Number.isFinite(sec) && sec >= 0) {
    if (sec < 20) return a.within20Sec;
    if (sec < 60) return tpl(a.aboutSeconds, { n: String(Math.floor(sec)) });
    if (sec < 120) return a.about1Min;
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
  const M = H.mdmNet;
  if (!net.available) {
    if (net.status !== "skipped") return null;
    const r = net.skippedReason || "";
    if (r === "simplemdm_not_configured") {
      return M.notConfigured;
    }
    if (r === "no_active_device_serial") {
      return M.noSerial;
    }
    if (r === "device_not_in_simplemdm") {
      return M.deviceMissing;
    }
    if (r === "simplemdm_rate_limited") {
      return M.rateLimited;
    }
    if (r === "simplemdm_error") {
      return M.queryFailed;
    }
    return null;
  }
  if (net.status === "recent") {
    const detail = formatSimpleMdmLastContactDetail(net);
    const carrier = net.carrierNetwork ? tpl(M.carrierSuffix, { carrier: net.carrierNetwork }) : "";
    const head = detail
      ? tpl(M.recentWithDetail, { detail, carrier })
      : tpl(M.recentRecent, { carrier });
    return tpl(M.recentTail, { head });
  }
  if (net.status === "stale") {
    const detail = formatSimpleMdmLastContactDetail(net);
    return detail ? tpl(M.staleWithDetail, { detail }) : M.staleOld;
  }
  if (net.status === "unknown") {
    return M.unknownLastSeen;
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
    suggestedPhraseLoading = false,
    parentLockStatus,
    hapticSelection
  } = props;

  const linked = parentStudents.length > 0;

  const studentId = selectedStudent?.id ?? null;

  const [studyRoomModalOpen, setStudyRoomModalOpen] = useState(false);
  const [studyRoomSaving, setStudyRoomSaving] = useState(false);
  const [freeModeToggling, setFreeModeToggling] = useState(false);
  const [freeMinutesModalOpen, setFreeMinutesModalOpen] = useState(false);
  const [freeMinutesChoice, setFreeMinutesChoice] = useState(15);
  const [freeMinutesCustom, setFreeMinutesCustom] = useState("");
  const [freeMinutesUseCustom, setFreeMinutesUseCustom] = useState(false);
  const [plannerEnabled, setPlannerEnabled] = useState(false);
  const [plannerTime, setPlannerTime] = useState("21:00");
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerSaving, setPlannerSaving] = useState(false);
  const [plannerTimeSheetOpen, setPlannerTimeSheetOpen] = useState(false);
  const [bulkKioskSaving, setBulkKioskSaving] = useState(false);
  const [delayedNetConnected, setDelayedNetConnected] = useState<boolean | null>(null);
  const [showNoLinkedHint, setShowNoLinkedHint] = useState(false);

  const freeMinutesModalReveal = useModalReveal(freeMinutesModalOpen);

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
    refresh: refreshDeviceSnapshot,
    patchSnapshot: patchDeviceSnapshot
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
          throw new Error(String(data.error || H.studyRoomSaveFailed));
        }
        setStudyRoomModalOpen(false);
        window.dispatchEvent(new Event(DAECHI_LINKS_UPDATED_EVENT));
      } catch (error) {
        void refreshDeviceSnapshot({ silent: true });
        alert(
          error instanceof Error && error.message
            ? error.message
            : H.studyRoomSaveError
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
        if (!res.ok) throw new Error(String(data.error || H.settingsLoadFailed));
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
      if (!res.ok) throw new Error(String(data.error || H.settingsSaveFailed));
      setPlannerEnabled(Boolean(data.rule?.enabled));
      setPlannerTime(String(data.rule?.lockTime || next.lockTime).slice(0, 5));
    } catch (error) {
      alert(
        error instanceof Error && error.message
          ? error.message
          : H.settingsSaveError
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

  /** 학생 설정 > 계획표 작성 시간 카드의 「지금 켜기/끄기」와 동일: 키오스크(계획표 작성) 모드 일괄 전환 */
  const toggleBulkKioskMode = async (nextEnabled: boolean) => {
    if (!authToken || !selectedStudent?.id) return;
    setBulkKioskSaving(true);
    try {
      const res = await fetch(
        `${apiBase}/api/parent/kiosk-mode/${nextEnabled ? "bulk-enable" : "bulk-disable"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ studentIds: [selectedStudent.id] })
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        summary?: { total?: number; success?: number; failed?: number };
      };
      if (!res.ok) {
        throw new Error(
          String(
            data.error ||
              (nextEnabled ? H.kioskEnableFailed : H.kioskDisableFailed)
          )
        );
      }
      if ((data.summary?.failed || 0) > 0) {
        alert(String(data.message || H.kioskPartialFailed));
        return;
      }
      patchDeviceSnapshot(prev => {
        const base = prev ?? computeParentDeviceControlSnapshot({});
        return { ...base, kioskEnabled: nextEnabled };
      });
      void refreshDeviceSnapshot({ silent: true });
    } catch (error) {
      alert(
        error instanceof Error && error.message
          ? error.message
          : H.kioskControlError
      );
    } finally {
      setBulkKioskSaving(false);
    }
  };

  const turnOffFreeMode = () => {
    if (!authToken || !selectedStudent?.id || freeModeToggling) return;
    if (deviceSnapshot?.activeAppAllowanceMode !== "free") return;
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
            mode: "default",
            studentIds: [selectedStudent.id]
          })
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; ok?: boolean };
        if (!res.ok || data.ok === false) {
          throw new Error(String(data.error || data.message || H.freeModeChangeFailed));
        }
        patchDeviceSnapshot(prev => patchParentDeviceSnapshotForAllowanceMode(prev, "default"));
        void refreshDeviceSnapshot({ silent: true });
      } catch (error) {
        void refreshDeviceSnapshot({ silent: true });
        alert(
          error instanceof Error && error.message
            ? error.message
            : H.freeModeChangeError
        );
      } finally {
        setFreeModeToggling(false);
      }
    })();
  };

  const applyFreeModeWithMinutes = (minutes: number) => {
    if (!authToken || !selectedStudent?.id || freeModeToggling) return;
    const m = Math.floor(Number(minutes));
    if (!Number.isFinite(m) || m < 1 || m > 180) {
      alert(H.freeMinutesRange);
      return;
    }
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
            mode: "free",
            studentIds: [selectedStudent.id],
            freeMinutes: m
          })
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; ok?: boolean };
        if (!res.ok || data.ok === false) {
          throw new Error(String(data.error || data.message || H.freeModeChangeFailed));
        }
        freeMinutesModalReveal.beginClose(() => setFreeMinutesModalOpen(false));
        const untilIso = new Date(Date.now() + m * 60_000).toISOString();
        patchDeviceSnapshot(prev =>
          patchParentDeviceSnapshotForAllowanceMode(prev, "free", {
            parentTimedFreeExpiresAt: untilIso
          })
        );
        void refreshDeviceSnapshot({ silent: true });
      } catch (error) {
        void refreshDeviceSnapshot({ silent: true });
        alert(
          error instanceof Error && error.message
            ? error.message
            : H.freeModeChangeError
        );
      } finally {
        setFreeModeToggling(false);
      }
    })();
  };

  const openFreeMinutesModal = () => {
    if (!authToken || !selectedStudent?.id || freeModeToggling) return;
    hapticSelection();
    setFreeMinutesUseCustom(false);
    setFreeMinutesCustom("");
    setFreeMinutesChoice(15);
    setFreeMinutesModalOpen(true);
  };

  const confirmFreeMinutesFromModal = () => {
    hapticSelection();
    if (freeMinutesUseCustom) {
      const n = Math.floor(Number(String(freeMinutesCustom).trim()));
      applyFreeModeWithMinutes(n);
      return;
    }
    applyFreeModeWithMinutes(freeMinutesChoice);
  };

  const phoneModeLabel = deviceSnapshot
    ? deviceSnapshot.displaySurfaceMode === "block"
      ? H.modeBlock
      : deviceSnapshot.activeAppAllowanceMode === "free"
        ? H.modeFree
        : deviceSnapshot.activeAppAllowanceMode === "utility"
          ? H.modeUtility
          : H.modeDefault
    : null;

  const freeTimedUntilLabel = useMemo(() => {
    if (deviceSnapshot?.activeAppAllowanceMode !== "free") return null;
    const iso = deviceSnapshot.parentTimedFreeExpiresAt;
    if (!iso) return null;
    const t = formatSeoulTimeLabel(iso);
    return t ? tpl(H.freeUntil, { time: t }) : null;
  }, [deviceSnapshot?.activeAppAllowanceMode, deviceSnapshot?.parentTimedFreeExpiresAt]);

  const plannerKioskModeActive = Boolean(deviceSnapshot?.kioskEnabled);

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
    return String(currentBlock.subject || "").trim() || H.subjectUnset;
  }, [parentReport]);

  return (
    <div className="coach-page parent-home">
      {!linked ? (
        <section className="section parent-home__live" aria-label={H.ariaLiveSection}>
          {showNoLinkedHint ? (
            <p className="parent-home__status-hint">
              {H.noLinkedHint}
            </p>
          ) : (
            null
          )}
        </section>
      ) : (
        <section className="section parent-home__live" aria-label={H.ariaLiveSection}>
          {selectedStudent ? (
            <>
              <div
                className="parent-home__coach-phrase-card parent-home__coach-phrase-card--with-title"
                aria-busy={suggestedPhraseLoading}
              >
                <p className="parent-home__coach-phrase-card-title">{H.coachGuideTitle}</p>
                {suggestedPhraseLoading ? (
                  <div className="parent-home__skeleton-phrase-row" aria-label={H.loadingCoachPhrase}>
                    <div className="parent-skeleton parent-skeleton--phrase" />
                    <div className="parent-skeleton parent-skeleton--phrase parent-skeleton--phrase-row-2" />
                  </div>
                ) : String(suggestedPhrase || "").trim() ? (
                  <p className="parent-home__coach-phrase parent-home__coach-phrase--fade">
                    {String(suggestedPhrase || "").trim()}
                  </p>
                ) : null}
              </div>
              <div
                className="parent-home__coach-phrase-card parent-home__coach-phrase-card--sub"
                aria-busy={delayedNetConnected == null}
              >
                {delayedNetConnected == null ? (
                  <div className="parent-skeleton parent-skeleton--phrase-short" aria-label={H.loadingNetStatus} />
                ) : (
                  <p className="parent-home__coach-phrase parent-home__coach-phrase--sub parent-home__coach-phrase--fade">
                    {delayedNetConnected ? H.netConnected : H.netDisconnected}
                  </p>
                )}
              </div>
              <div className="parent-home__status-grid">
                <div className="parent-home__status-card">
                <div className="parent-home__status-card-head">
                  <MapPin size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">{H.liveLocationTitle}</span>
                </div>
                <div className="parent-home__status-center">
                  {!hasStudyRoomConfig ? (
                    <p className="parent-home__status-body parent-home__status-body--fade">{H.studyRoomNotRegistered}</p>
                  ) : typeof studyRoomLiveStatus.currentWithinRadius === "boolean" ? (
                    <p className="parent-home__status-body parent-home__status-body--fade">
                      {studyRoomLiveStatus.currentWithinRadius ? H.checkIn : H.checkOut}
                    </p>
                  ) : studyRoomVisitsLoading ? (
                    <div className="parent-skeleton parent-skeleton--status-wide" aria-label={H.loadingLocationStatus} />
                  ) : (
                    <p className="parent-home__status-body parent-home__status-body--fade">{H.statusUnknown}</p>
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
                    {H.studyRoomSettings}
                  </button>
                </div>
              </div>
              <div className="parent-home__status-card">
                <div className="parent-home__status-card-head">
                  <Smartphone size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">{H.phoneModeTitle}</span>
                </div>
                {deviceLoading && !deviceSnapshot ? (
                  <div className="parent-home__status-center" aria-busy="true" aria-label={H.loadingPhoneMode}>
                    <div className="parent-skeleton parent-skeleton--status-wide" />
                  </div>
                ) : deviceSnapshot ? (
                  <div className="parent-home__status-center">
                    <p className="parent-home__status-body parent-home__status-body--fade">
                      {phoneModeLabel ? (
                        <span className="parent-home__status-em">
                          {phoneModeLabel}
                          {plannerKioskModeActive ? H.plannerSuffix : ""}
                        </span>
                      ) : (
                        H.modeLoadFailed
                      )}
                    </p>
                    {freeTimedUntilLabel ? (
                      <p className="parent-home__free-until-hint">{freeTimedUntilLabel}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="parent-home__status-center">
                    <p className="parent-home__status-body parent-home__status-body--fade">{H.deviceStatusFailed}</p>
                  </div>
                )}
                <div className="parent-home__status-card-footer">
                  <button
                    type="button"
                    className="timeline-save-button study-room-editor__save-button parent-home__status-action"
                    onClick={() => {
                      if (deviceSnapshot?.activeAppAllowanceMode === "free") {
                        hapticSelection();
                        turnOffFreeMode();
                      } else {
                        openFreeMinutesModal();
                      }
                    }}
                    disabled={!selectedStudent?.id || !authToken || freeModeToggling}
                    aria-busy={freeModeToggling}
                  >
                    {deviceSnapshot?.activeAppAllowanceMode === "free" ? H.freeOff : H.freeTimeGive}
                  </button>
                </div>
              </div>
              <div className="parent-home__status-card" aria-label={H.plannerCardAria}>
                <div className="parent-home__status-card-head">
                  <CalendarDays size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">{H.plannerTitle}</span>
                  {plannerLoading ? (
                    <div
                      className="parent-home__skeleton-toggle-pill parent-home__skeleton-shimmer"
                      aria-hidden
                    />
                  ) : (
                    <button
                      type="button"
                      className="parent-home__planner-now-toggle"
                      onClick={() => {
                        hapticSelection();
                        void toggleBulkKioskMode(!Boolean(deviceSnapshot?.kioskEnabled));
                      }}
                      disabled={bulkKioskSaving || !selectedStudent?.id || !authToken}
                      aria-pressed={Boolean(deviceSnapshot?.kioskEnabled)}
                      aria-label={deviceSnapshot?.kioskEnabled ? H.plannerBulkOff : H.plannerBulkOn}
                      aria-busy={bulkKioskSaving}
                    >
                      {bulkKioskSaving ? (
                        <span
                          className="parent-settings-inline-spinner parent-settings-inline-spinner--inverse"
                          aria-hidden
                        />
                      ) : deviceSnapshot?.kioskEnabled ? (
                        H.plannerBulkOff
                      ) : (
                        H.plannerBulkOn
                      )}
                    </button>
                  )}
                </div>
                {plannerLoading ? (
                  <div
                    className="parent-home__status-center parent-home__skeleton-planner-stack"
                    aria-busy="true"
                    aria-label={H.loadingPlannerSettings}
                  >
                    <div className="parent-home__skeleton-planner-time parent-home__skeleton-shimmer" />
                    <div className="parent-home__skeleton-planner-action parent-home__skeleton-shimmer" />
                  </div>
                ) : (
                  <>
                    <div className="parent-home__status-center">
                      <button
                        type="button"
                        className="parent-home__status-time-btn"
                        disabled={!plannerEnabled || plannerSaving}
                        onClick={() => setPlannerTimeSheetOpen(true)}
                        aria-label={H.plannerTimeSetAria}
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
                        aria-label={plannerEnabled ? H.timeSettingOff : H.timeSettingOn}
                        disabled={plannerSaving}
                        aria-busy={plannerSaving}
                      >
                        {plannerEnabled ? H.timeSettingOff : H.timeSettingOn}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="parent-home__status-card" aria-label={H.currentStudyCardAria}>
                <div className="parent-home__status-card-head">
                  <BookOpen size={18} strokeWidth={2} aria-hidden />
                  <span className="parent-home__status-card-title">{H.currentStudyTitle}</span>
                </div>
                <div className="parent-home__status-center" aria-busy={!reportReady}>
                  {reportReady ? (
                    <p className="parent-home__status-body parent-home__status-body--fade">
                      {currentTimelineStudy || H.plannerNotConfigured}
                    </p>
                  ) : (
                    <div className="parent-skeleton parent-skeleton--status-wide" aria-label={H.loadingStudySchedule} />
                  )}
                </div>
                </div>
              </div>
            </>
          ) : (
            <p className="parent-home__status-hint">{H.selectStudentHint}</p>
          )}
        </section>
      )}
      {linked ? (
        <ParentRecordsWeekSection
          apiBase={apiBase}
          authToken={authToken}
          selectedStudent={selectedStudent}
          parentReport={parentReport}
          parentWeekOffset={props.parentWeekOffset}
          setParentWeekOffset={props.setParentWeekOffset}
        />
      ) : null}
      {freeMinutesModalOpen ? (
        <div
          className={"dday-modal" + (freeMinutesModalReveal.revealed ? " dday-modal--open" : "")}
          role="presentation"
          onClick={() => {
            if (freeModeToggling) return;
            freeMinutesModalReveal.beginClose(() => setFreeMinutesModalOpen(false));
          }}
        >
          <div
            className="dday-modal-inner parent-home__free-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="parent-home-free-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="dday-modal-header">
              <span id="parent-home-free-modal-title" className="dday-modal-title">
                {H.freeModalTitle}
              </span>
            </div>
            <div className="dday-modal-body parent-home__free-modal-body">
              <p className="parent-home__free-modal-lead">
                {H.freeModalLead}
              </p>
              <div className="parent-home__free-chip-grid" role="group" aria-label={H.minutePickAria}>
                {PARENT_FREE_MINUTE_PRESETS.map(min => (
                  <button
                    key={min}
                    type="button"
                    className={
                      "parent-home__free-chip" +
                      (!freeMinutesUseCustom && freeMinutesChoice === min
                        ? " parent-home__free-chip--active"
                        : "")
                    }
                    disabled={freeModeToggling}
                    onClick={() => {
                      hapticSelection();
                      setFreeMinutesUseCustom(false);
                      setFreeMinutesChoice(min);
                    }}
                  >
                    {`${min}${H.minuteUnit}`}
                  </button>
                ))}
              </div>
              <div className="parent-home__free-custom">
                <label className="parent-home__free-custom-label">
                  <input
                    type="checkbox"
                    checked={freeMinutesUseCustom}
                    disabled={freeModeToggling}
                    onChange={e => setFreeMinutesUseCustom(e.target.checked)}
                  />{" "}
                  {H.customInputLabel}
                </label>
                {freeMinutesUseCustom ? (
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={180}
                    className="parent-home__free-custom-input"
                    value={freeMinutesCustom}
                    placeholder={H.customPlaceholder}
                    disabled={freeModeToggling}
                    onChange={e => setFreeMinutesCustom(e.target.value)}
                  />
                ) : null}
              </div>
            </div>
            <div className="dday-modal-footer parent-home__free-modal-footer">
              <button
                type="button"
                className="modal-secondary"
                disabled={freeModeToggling}
                onClick={() => {
                  hapticSelection();
                  freeMinutesModalReveal.beginClose(() => setFreeMinutesModalOpen(false));
                }}
              >
                {H.cancel}
              </button>
              <button
                type="button"
                className="modal-primary"
                disabled={freeModeToggling}
                onClick={() => confirmFreeMinutesFromModal()}
              >
                {H.apply}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
