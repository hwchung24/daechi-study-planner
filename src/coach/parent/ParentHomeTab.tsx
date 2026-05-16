import React, { useEffect, useMemo, useState } from "react";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { ParentStudentRow } from "../../types/parent";
import type { StudyRoomSetting } from "../../components/parent/StudyRoomPickerModal";
import { DAECHI_LINKS_UPDATED_EVENT } from "../../lib/linkEvents";
import { getDateKeySeoul, seoulDateKeyFromApiValue } from "../../lib/weekDates";
import { ParentStudentSelector } from "./ParentStudentSelector";
import {
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
import { ParentHomeInsight } from "./ParentHomeInsight";
import { ParentHomeLivePanel } from "./ParentHomeLivePanel";
import { ParentVisitStudyBar } from "./ParentVisitStudyBar";
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
  parentReportLoaded?: boolean;
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

export function ParentHomeTab(props: ParentHomeTabProps) {
  const {
    apiBase,
    authToken,
    parentStudents,
    parentStudentId,
    setParentStudentId,
    selectedStudent,
    parentReport,
    parentReportLoaded = false,
    suggestedPhrase,
    suggestedPhraseLoading = false,
    parentLockStatus,
    hapticSelection
  } = props;

  const linked = parentStudents.length > 0;

  const studentId = selectedStudent?.id ?? null;

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
  const [bulkDaechiRootLockSaving, setBulkDaechiRootLockSaving] = useState(false);
  const [activatingAppMode, setActivatingAppMode] = useState<"utility" | "free" | null>(null);
  const [delayedNetConnected, setDelayedNetConnected] = useState<boolean | null>(null);
  const [showNoLinkedHint, setShowNoLinkedHint] = useState(false);
  const freeMinutesModalReveal = useModalReveal(freeMinutesModalOpen);

  const {
    studyRoomVisits,
    studyRoomVisitsByDate,
    studyRoomVisitsLoading,
    studyRoomLiveStatus,
    hasStudyRoomConfig,
    refreshStudyRoomVisits,
    refreshStudentLocation,
    locationRefreshLoading
  } = useParentStudyRoomLive({
      apiBase,
      authToken,
      studentId,
      hasStudyRoomSettingHint: Boolean(selectedStudent?.studyRoom)
    });

  const {
    loading: deviceLoading,
    snapshot: deviceSnapshot,
    refresh: refreshDeviceSnapshot,
    patchSnapshot: patchDeviceSnapshot,
    verifyMdmLink,
    mdmVerifyLoading
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
        window.dispatchEvent(new Event(DAECHI_LINKS_UPDATED_EVENT));
      } catch (error) {
        void refreshDeviceSnapshot({ silent: true });
        const message =
          error instanceof Error && error.message ? error.message : H.studyRoomSaveError;
        alert(message);
        throw error instanceof Error ? error : new Error(message);
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
      const message =
        error instanceof Error && error.message ? error.message : H.settingsSaveError;
      alert(message);
      throw error instanceof Error ? error : new Error(message);
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
          ? H.modeMove
          : H.modeDefault
    : null;

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

  const currentStudyDisplay = useMemo(() => {
    if (!parentReportLoaded) return { kind: "loading" as const };
    const days = Array.isArray(parentReport?.days) ? parentReport.days : [];
    const blocks = Array.isArray(parentReport?.blocks) ? parentReport.blocks : [];
    if (!parentReport || blocks.length === 0) {
      return { kind: "message" as const, text: H.noStudySchedule };
    }
    const todayKey = getDateKeySeoul(0);
    const todayDay = days.find(day => seoulDateKeyFromApiValue(day.date) === todayKey);
    if (!todayDay) {
      return { kind: "message" as const, text: H.noStudyToday };
    }
    const todayBlocks = blocks.filter(
      block => Number(block.study_day_id) === Number(todayDay.id)
    );
    if (todayBlocks.length === 0) {
      return { kind: "message" as const, text: H.noStudyToday };
    }
    if (currentTimelineStudy) {
      return { kind: "active" as const, text: currentTimelineStudy };
    }
    return { kind: "message" as const, text: H.notInStudyWindow };
  }, [currentTimelineStudy, parentReport, parentReportLoaded]);

  const todayKey = getDateKeySeoul(0);
  const todayVisits = useMemo(
    () => studyRoomVisitsByDate.get(todayKey) || [],
    [studyRoomVisitsByDate, todayKey]
  );
  const todayDayAndBlocks = useMemo(() => {
    const days = Array.isArray(parentReport?.days) ? parentReport.days : [];
    const blocks = Array.isArray(parentReport?.blocks) ? parentReport.blocks : [];
    const todayDay = days.find(day => seoulDateKeyFromApiValue(day.date) === todayKey);
    if (!todayDay) return { todayDayId: null as number | null, todayBlocks: [] as typeof blocks };
    const todayDayId = Number(todayDay.id);
    const todayBlocks = blocks.filter(b => Number(b.study_day_id) === todayDayId);
    return {
      todayDayId: Number.isFinite(todayDayId) ? todayDayId : null,
      todayBlocks
    };
  }, [parentReport, todayKey]);

  const isUtilityModeActive = deviceSnapshot?.activeAppAllowanceMode === "utility";
  const isFreeModeActive = deviceSnapshot?.activeAppAllowanceMode === "free";
  const isBlockModeActive = deviceSnapshot?.displaySurfaceMode === "block";
  const anyModeControlBusy =
    freeModeToggling || activatingAppMode != null || bulkDaechiRootLockSaving;

  const activateAllowanceModeDirect = (mode: "utility" | "free" | "default") => {
    if (!authToken || !selectedStudent?.id || anyModeControlBusy) return;
    const activating: "utility" | "free" | null =
      mode === "utility" ? "utility" : mode === "free" ? "free" : null;
    setActivatingAppMode(activating);
    patchDeviceSnapshot(prev => patchParentDeviceSnapshotForAllowanceMode(prev, mode));
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/parent/app-allowance/activate-mode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ mode, studentIds: [selectedStudent.id] })
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          ok?: boolean;
        };
        if (!res.ok || data.ok === false) {
          throw new Error(String(data.error || data.message || H.freeModeChangeFailed));
        }
        void refreshDeviceSnapshot({ silent: true });
      } catch (error) {
        void refreshDeviceSnapshot({ silent: true });
        alert(error instanceof Error ? error.message : H.freeModeChangeError);
      } finally {
        setActivatingAppMode(null);
      }
    })();
  };

  const toggleUtilityModeNow = () => {
    hapticSelection();
    activateAllowanceModeDirect(isUtilityModeActive ? "default" : "utility");
  };

  const toggleFreeModeNow = () => {
    hapticSelection();
    activateAllowanceModeDirect(isFreeModeActive ? "default" : "free");
  };

  const toggleBulkDaechiRootLock = (nextLocked: boolean) => {
    if (!authToken || !selectedStudent?.id || anyModeControlBusy) return;
    hapticSelection();
    setBulkDaechiRootLockSaving(true);
    patchDeviceSnapshot(prev => {
      const base = prev ?? computeParentDeviceControlSnapshot({});
      if (nextLocked) {
        return { ...base, displaySurfaceMode: "block", activeAppAllowanceMode: null };
      }
      return { ...base, displaySurfaceMode: "default", activeAppAllowanceMode: null };
    });
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/parent/app-allowance/${nextLocked ? "bulk-daechiroot-lock" : "bulk-daechiroot-unlock"}`,
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
          summary?: { failed?: number };
        };
        if (!res.ok) {
          throw new Error(
            String(data.error || (nextLocked ? H.bulkLockEnableFailed : H.bulkLockDisableFailed))
          );
        }
        if ((data.summary?.failed || 0) > 0) {
          alert(String(data.message || H.bulkLockPartialFailed));
          void refreshDeviceSnapshot({ silent: true });
          return;
        }
        void refreshDeviceSnapshot({ silent: true });
      } catch (error) {
        void refreshDeviceSnapshot({ silent: true });
        alert(error instanceof Error ? error.message : H.bulkLockControlError);
      } finally {
        setBulkDaechiRootLockSaving(false);
      }
    })();
  };

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
              <ParentHomeInsight
                fullPhrase={suggestedPhrase}
                loading={suggestedPhraseLoading}
                parentReport={parentReport}
              />
              <ParentHomeLivePanel
                apiBase={apiBase}
                authToken={authToken}
                netConnected={delayedNetConnected}
                netLoading={delayedNetConnected == null && Boolean(selectedStudent)}
                mdmVerifyLoading={mdmVerifyLoading}
                onRecheckNet={() => {
                  hapticSelection();
                  void verifyMdmLink();
                }}
                hasStudyRoomConfig={hasStudyRoomConfig}
                studyRoomVisitsLoading={studyRoomVisitsLoading}
                locationRefreshLoading={locationRefreshLoading}
                studyRoomName={studyRoomLiveStatus.studyRoomName}
                studyRoomWithinRadius={studyRoomLiveStatus.currentWithinRadius}
                studyRoomLive={studyRoomLiveStatus}
                onRefreshLocation={options => {
                  void refreshStudentLocation(options);
                }}
                todayVisits={todayVisits}
                displaySurfaceMode={deviceSnapshot?.displaySurfaceMode ?? null}
                plannerKioskModeActive={plannerKioskModeActive}
                currentStudyDisplay={currentStudyDisplay}
                parentReportLoaded={parentReportLoaded}
                todayPlanBlocks={todayDayAndBlocks.todayBlocks}
                hasAnyWeekPlanBlocks={
                  (Array.isArray(parentReport?.blocks) ? parentReport.blocks : []).length > 0
                }
                selectedStudent={selectedStudent}
                plannerLoading={plannerLoading}
                plannerScheduleEnabled={plannerEnabled}
                visitBar={
                  todayVisits.length > 0 || todayDayAndBlocks.todayBlocks.length > 0 ? (
                    <ParentVisitStudyBar
                      compact
                      visits={todayVisits}
                      todayBlocks={todayDayAndBlocks.todayBlocks}
                      todayDayId={todayDayAndBlocks.todayDayId}
                    />
                  ) : undefined
                }
                hapticSelection={hapticSelection}
                studyRoomQuickControls={{
                  saving: studyRoomSaving,
                  onSave: saveStudyRoomSetting
                }}
                plannerQuickControls={{
                  loading: plannerLoading,
                  saving: plannerSaving,
                  enabled: plannerEnabled,
                  lockTime: plannerTime,
                  kioskActive: plannerKioskModeActive,
                  kioskActivating: bulkKioskSaving,
                  anyBusy: plannerSaving || bulkKioskSaving || plannerLoading,
                  onToggleKioskNow: () => {
                    hapticSelection();
                    void toggleBulkKioskMode(!plannerKioskModeActive);
                  },
                  onSave: savePlannerRule
                }}
                modeQuickControls={{
                  anyBusy: anyModeControlBusy,
                  utility: {
                    active: isUtilityModeActive,
                    activating: activatingAppMode === "utility",
                    onToggle: toggleUtilityModeNow
                  },
                  free: {
                    active: isFreeModeActive,
                    activating: activatingAppMode === "free" || freeModeToggling,
                    onToggle: toggleFreeModeNow
                  },
                  block: {
                    active: isBlockModeActive,
                    activating: bulkDaechiRootLockSaving,
                    onToggle: () => toggleBulkDaechiRootLock(!isBlockModeActive)
                  }
                }}
              />
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
            </>
          ) : (
            <p className="parent-home__status-hint">{H.selectStudentHint}</p>
          )}
        </section>
      )}
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
    </div>
  );
}
