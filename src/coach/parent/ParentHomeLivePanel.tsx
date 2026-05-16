import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalReveal } from "../../lib/useModalReveal";
import {
  BookOpen,
  CalendarDays,
  MapPin,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff
} from "lucide-react";
import type { ParentStudentRow } from "../../types/parent";
import {
  PARENT_MDM_SURFACE_LABEL,
  type ParentMdmSurfaceMode
} from "./parentDeviceModeDisplay";
import {
  elapsedMinutesFromIso,
  formatElapsedMinutesKo,
  formatSeoulClockNow,
  todayVisitContext
} from "./parentHomeMetrics";
import type { ParentStudyRoomLiveStatus } from "./useParentStudyRoomLive";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";
import { getDateKeySeoul } from "../../lib/weekDates";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";
import {
  ParentModeQuickSchedulePanel,
  type ParentModeQuickSchedulePanelHandle
} from "./ParentModeQuickSchedulePanel";
import {
  ParentPlannerQuickPanel,
  type ParentPlannerQuickPanelHandle
} from "./ParentPlannerQuickPanel";
import {
  StudyRoomPickerEditor,
  type StudyRoomPickerEditorHandle,
  type StudyRoomSetting
} from "../../components/parent/StudyRoomPickerModal";
import type { ModeScheduleModeKey } from "./ModeScheduleGrid";
import { ParentHomeLocationCheckMap } from "./ParentHomeLocationCheckMap";
import {
  ParentHomeTodayPlanModalBody,
  getTodayPlanViewState,
  type ParentTodayPlanBlock
} from "./ParentHomeTodayPlanModal";
import { sendParentAdminChannelMessage } from "../../lib/parentAdminChannelMessage";

const H = ko.parentHomeTab;
const ME = ko.parentModeExplain;

type QuickModalId = "planner" | "studyRoom" | "freeMode" | "moveMode" | "blockMode";

const QUICK_MODALS: ReadonlyArray<{ id: QuickModalId; label: string }> = [
  { id: "planner", label: H.statusQuickPlanner },
  { id: "studyRoom", label: H.statusQuickStudyRoom },
  { id: "freeMode", label: H.statusQuickFreeMode },
  { id: "moveMode", label: H.statusQuickMoveMode },
  { id: "blockMode", label: H.statusQuickBlockMode }
];

const SCHEDULE_MODE_META: Record<
  ModeScheduleModeKey,
  { eyebrow: string; subtitle: string }
> = {
  utility: { eyebrow: H.modeMoveOfficial, subtitle: ME.utility },
  free: { eyebrow: H.modeFreeOfficial, subtitle: ME.free },
  block: { eyebrow: H.modeBlockOfficial, subtitle: ME.block }
};

const PLANNER_SHEET_META = {
  eyebrow: H.settingsListPlanner,
  subtitle: ME.schedule
};

const STUDY_ROOM_SHEET_META = {
  eyebrow: H.settingsListLocation,
  subtitle: H.studyRoomQuickSubtitle,
  title: H.studyRoomQuickTitle
};

function formatSeoulDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(d);
}

function formatDistanceMeters(m: number | null | undefined) {
  if (m == null || !Number.isFinite(m)) return "—";
  const n = Math.round(m);
  if (n >= 1000) {
    const km = n / 1000;
    return km >= 10 ? `${Math.round(km)}km` : `${km.toFixed(1)}km`;
  }
  return `${n}m`;
}

type CurrentStudyDisplay =
  | { kind: "loading" }
  | { kind: "active"; text: string }
  | { kind: "message"; text: string };

function LiveRow(props: {
  icon: React.ReactNode;
  title: string;
  status: string;
  warn?: boolean;
  trailing?: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <div className={"parent-home__live-row" + (props.warn ? " parent-home__live-row--warn" : "")}>
      <div className="parent-home__live-row-main">
        <span className="parent-home__live-row-icon" aria-hidden>
          {props.icon}
        </span>
        <div className="parent-home__live-row-body">
          <span className="parent-home__live-row-title">{props.title}</span>
          <p className="parent-home__live-row-status">{props.status}</p>
        </div>
        {props.trailing ? <div className="parent-home__live-row-trail">{props.trailing}</div> : null}
      </div>
      {props.below ? <div className="parent-home__live-row-below">{props.below}</div> : null}
    </div>
  );
}

export function ParentHomeLivePanel(props: {
  apiBase: string;
  authToken: string | null;
  netConnected: boolean | null;
  netLoading?: boolean;
  mdmVerifyLoading?: boolean;
  onRecheckNet: () => void;
  hasStudyRoomConfig: boolean;
  studyRoomVisitsLoading: boolean;
  locationRefreshLoading?: boolean;
  studyRoomName: string | null;
  studyRoomWithinRadius: boolean | undefined;
  studyRoomLive: ParentStudyRoomLiveStatus;
  onRefreshLocation?: (options?: { silent?: boolean }) => void;
  todayVisits: StudyRoomVisitSession[];
  displaySurfaceMode: ParentMdmSurfaceMode | null;
  plannerKioskModeActive?: boolean;
  currentStudyDisplay: CurrentStudyDisplay;
  parentReportLoaded?: boolean;
  todayPlanBlocks: ParentTodayPlanBlock[];
  hasAnyWeekPlanBlocks: boolean;
  selectedStudent: ParentStudentRow;
  plannerLoading: boolean;
  plannerScheduleEnabled: boolean;
  visitBar?: React.ReactNode;
  hapticSelection: () => void;
  studyRoomQuickControls?: {
    saving: boolean;
    onSave: (value: StudyRoomSetting) => void | Promise<void>;
  };
  plannerQuickControls?: {
    loading: boolean;
    saving: boolean;
    enabled: boolean;
    lockTime: string;
    kioskActive: boolean;
    kioskActivating: boolean;
    anyBusy: boolean;
    onToggleKioskNow: () => void;
    onSave: (next: { enabled: boolean; lockTime: string }) => void | Promise<void>;
  };
  modeQuickControls?: {
    anyBusy: boolean;
    utility: { active: boolean; activating: boolean; onToggle: () => void };
    free: { active: boolean; activating: boolean; onToggle: () => void };
    block: { active: boolean; activating: boolean; onToggle: () => void };
  };
}) {
  const [quickModalId, setQuickModalId] = useState<QuickModalId | null>(null);
  const schedulePanelRef = useRef<ParentModeQuickSchedulePanelHandle>(null);
  const plannerPanelRef = useRef<ParentPlannerQuickPanelHandle>(null);
  const studyRoomPanelRef = useRef<StudyRoomPickerEditorHandle>(null);
  const [scheduleBusy, setScheduleBusy] = useState({ saving: false, loading: false });
  const [plannerBusy, setPlannerBusy] = useState({ saving: false, loading: false });
  const [studyRoomCanSave, setStudyRoomCanSave] = useState(false);
  const [locationCheckOpen, setLocationCheckOpen] = useState(false);
  const locationCheckReveal = useModalReveal(locationCheckOpen);
  const [todayPlanOpen, setTodayPlanOpen] = useState(false);
  const [todayPlanRequestSending, setTodayPlanRequestSending] = useState(false);
  const [todayPlanRequestError, setTodayPlanRequestError] = useState<string | null>(null);
  const todayPlanReveal = useModalReveal(todayPlanOpen);
  const quickModalReveal = useModalReveal(quickModalId != null);
  const quickModalTitle = QUICK_MODALS.find(m => m.id === quickModalId)?.label ?? "";

  const closeQuickModal = () => {
    quickModalReveal.beginClose(() => setQuickModalId(null));
  };

  const closeLocationCheckModal = () => {
    locationCheckReveal.beginClose(() => setLocationCheckOpen(false));
  };

  const openLocationCheckModal = () => {
    props.hapticSelection();
    props.onRefreshLocation?.({ silent: true });
    setLocationCheckOpen(true);
  };

  const closeTodayPlanModal = () => {
    todayPlanReveal.beginClose(() => {
      setTodayPlanOpen(false);
      setTodayPlanRequestError(null);
    });
  };

  const openTodayPlanModal = () => {
    props.hapticSelection();
    setTodayPlanRequestError(null);
    setTodayPlanOpen(true);
  };

  const todayPlanViewState = getTodayPlanViewState({
    blocks: props.todayPlanBlocks,
    reportLoaded: Boolean(props.parentReportLoaded),
    hasAnyWeekBlocks: props.hasAnyWeekPlanBlocks
  });
  const showTodayPlanRequestButton = todayPlanViewState === "no_planner";

  const requestTodayPlanViaChat = async () => {
    if (!props.authToken || todayPlanRequestSending) return;
    props.hapticSelection();
    setTodayPlanRequestError(null);
    setTodayPlanRequestSending(true);
    try {
      await sendParentAdminChannelMessage(
        props.apiBase,
        props.authToken,
        props.selectedStudent.id,
        H.todayPlanRequestChatMessage
      );
      closeTodayPlanModal();
    } catch {
      setTodayPlanRequestError(H.todayPlanRequestError);
    } finally {
      setTodayPlanRequestSending(false);
    }
  };

  const scheduleModeKey: ModeScheduleModeKey | null =
    quickModalId === "moveMode"
      ? "utility"
      : quickModalId === "freeMode"
        ? "free"
        : quickModalId === "blockMode"
          ? "block"
          : null;

  const quickModalIsPlanner = quickModalId === "planner";
  const quickModalIsStudyRoom = quickModalId === "studyRoom";
  const quickModalIsSchedule = scheduleModeKey != null;
  const quickModalIsSheet = quickModalIsSchedule || quickModalIsPlanner || quickModalIsStudyRoom;
  const scheduleModeMeta = scheduleModeKey ? SCHEDULE_MODE_META[scheduleModeKey] : null;

  const clock = useMemo(() => formatSeoulClockNow(), []);

  const locationLine = useMemo(() => {
    if (!props.hasStudyRoomConfig) return H.statusHeroLocationNoRoom;
    if (props.studyRoomVisitsLoading) return H.statusHeroLocationLoading;
    const { active } = todayVisitContext(props.todayVisits, getDateKeySeoul(0));
    if (active) {
      const elapsed = elapsedMinutesFromIso(active.enteredAt);
      const room = String(active.studyRoomName || props.studyRoomName || "").trim();
      if (elapsed != null && room) {
        return tpl(H.statusHeroLocationInRoom, {
          room,
          elapsed: formatElapsedMinutesKo(elapsed)
        });
      }
      if (room) return tpl(H.statusHeroLocationInRoomShort, { room });
    }
    if (typeof props.studyRoomWithinRadius === "boolean") {
      return props.studyRoomWithinRadius
        ? tpl(H.statusHeroLocationRadiusIn, {
            room: String(props.studyRoomName || H.checkIn).trim()
          })
        : H.statusHeroLocationRadiusOut;
    }
    return H.statusHeroLocationNoVisit;
  }, [
    props.hasStudyRoomConfig,
    props.studyRoomVisitsLoading,
    props.studyRoomName,
    props.studyRoomWithinRadius,
    props.todayVisits
  ]);

  const modeLine = useMemo(() => {
    if (!props.displaySurfaceMode) return H.statusHeroModeUnknown;
    if (props.plannerKioskModeActive) {
      const modeShort =
        props.displaySurfaceMode === "block"
          ? H.modeBlock
          : props.displaySurfaceMode === "utility"
            ? H.modeMove
            : props.displaySurfaceMode === "free"
              ? H.modeFree
              : props.displaySurfaceMode === "schedule"
                ? PARENT_MDM_SURFACE_LABEL.schedule
                : H.modeDefault;
      return tpl(H.settingsBannerTpl, {
        mode: modeShort,
        planner: H.settingsPlannerOn
      });
    }
    return ME[props.displaySurfaceMode as keyof typeof ME] || ME.default;
  }, [props.displaySurfaceMode, props.plannerKioskModeActive]);

  const studyLine = useMemo(() => {
    if (props.currentStudyDisplay.kind === "loading") return H.loadingStudySchedule;
    if (props.currentStudyDisplay.kind === "active") {
      return tpl(H.statusHeroStudyingNow, { subject: props.currentStudyDisplay.text });
    }
    const text = props.currentStudyDisplay.text;
    if (text === H.noStudySchedule) return H.statusHeroStudyNoPlanner;
    if (text === H.noStudyToday) return H.statusHeroStudyNoToday;
    if (text === H.notInStudyWindow) return H.statusHeroStudyNotNow;
    return text;
  }, [props.currentStudyDisplay]);

  const netOk = props.netConnected;
  const locationWarn =
    props.hasStudyRoomConfig &&
    !props.studyRoomVisitsLoading &&
    typeof props.studyRoomWithinRadius === "boolean" &&
    !props.studyRoomWithinRadius &&
    !todayVisitContext(props.todayVisits, getDateKeySeoul(0)).active;

  const netLabel = props.netLoading
    ? H.loadingNetStatus
    : netOk
      ? H.statusHeroNetOk
      : H.statusHeroNetWarn;

  const locationBelow =
    props.visitBar ??
    (!props.hasStudyRoomConfig ? (
      <p className="parent-type-caption parent-home__live-row-caption">{H.controlLocationHint}</p>
    ) : null);

  return (
    <>
    <article
      className="coach-card coach-card--padded parent-home__live-panel"
      aria-label={H.statusHeroAria}
    >
      <header className="parent-home__live-panel-head">
        <h2 className="parent-home__live-panel-title">{H.statusHeroAria}</h2>
        <p className="parent-home__live-clock">{tpl(H.statusHeroClock, { time: clock })}</p>
      </header>

      <div className="parent-home__live-list">
        <LiveRow
          warn={netOk === false && !props.netLoading}
          icon={netOk ? <Wifi size={16} strokeWidth={2} /> : <WifiOff size={16} strokeWidth={2} />}
          title={H.kpiNet}
          status={netLabel}
          trailing={
            netOk === false && !props.netLoading ? (
              <button
                type="button"
                className={
                  "parent-home__chip-btn parent-home__chip-btn--sm" +
                  (props.mdmVerifyLoading ? " parent-home__chip-btn--loading" : "")
                }
                disabled={props.mdmVerifyLoading}
                aria-busy={props.mdmVerifyLoading || undefined}
                onClick={props.onRecheckNet}
              >
                <RefreshCw size={14} aria-hidden className={props.mdmVerifyLoading ? "parent-home__chip-btn-spin" : undefined} />
                {props.mdmVerifyLoading ? H.statusHeroRecheckNetVerifying : H.statusHeroRecheckNet}
              </button>
            ) : null
          }
        />
        <LiveRow
          icon={<Smartphone size={16} strokeWidth={2} />}
          title={H.phoneModeTitle}
          status={modeLine}
        />
        <LiveRow
          warn={locationWarn}
          icon={<MapPin size={16} strokeWidth={2} />}
          title={H.liveLocationTitle}
          status={locationLine}
          trailing={
            props.hasStudyRoomConfig && !props.studyRoomVisitsLoading ? (
              <button
                type="button"
                className="parent-home__chip-btn parent-home__chip-btn--sm parent-home__live-location-check-btn"
                aria-haspopup="dialog"
                onClick={openLocationCheckModal}
              >
                {H.liveLocationCheckButton}
              </button>
            ) : null
          }
          below={locationBelow}
        />
        <LiveRow
          icon={<BookOpen size={16} strokeWidth={2} />}
          title={H.plannerTitle}
          status={studyLine}
          trailing={
            props.parentReportLoaded ? (
              <button
                type="button"
                className="parent-home__chip-btn parent-home__chip-btn--sm parent-home__live-today-plan-btn"
                aria-haspopup="dialog"
                onClick={openTodayPlanModal}
              >
                {H.todayPlanCheckButton}
              </button>
            ) : null
          }
        />
      </div>

      <div className="parent-home__live-quick-actions" role="group" aria-label={H.statusQuickActionsAria}>
        {QUICK_MODALS.map(item => (
          <button
            key={item.id}
            type="button"
            className={
              "parent-home__chip-btn parent-home__live-quick-btn" +
              (item.id === "planner" ? " parent-home__live-quick-btn--planner" : "")
            }
            data-quick-id={item.id}
            aria-haspopup="dialog"
            onClick={() => {
              props.hapticSelection();
              setQuickModalId(item.id);
            }}
          >
            {item.id === "planner" ? (
              <span className="parent-home__live-quick-btn-stack">
                <span className="parent-home__live-quick-btn-label">{item.label}</span>
                <span
                  className={
                    "parent-home__live-quick-btn-meta" +
                    (props.plannerLoading
                      ? ""
                      : props.plannerScheduleEnabled
                        ? " parent-home__live-quick-btn-meta--on"
                        : " parent-home__live-quick-btn-meta--off")
                  }
                >
                  {props.plannerLoading
                    ? H.loadingPlannerSettings
                    : props.plannerScheduleEnabled
                      ? H.plannerQuickStatusOn
                      : H.plannerQuickStatusOff}
                </span>
              </span>
            ) : (
              item.label
            )}
          </button>
        ))}
      </div>
    </article>

    {quickModalId != null
      ? createPortal(
          <div
            className={"dday-modal" + (quickModalReveal.revealed ? " dday-modal--open" : "")}
            role="presentation"
            onClick={closeQuickModal}
          >
            <div
              className={
                "dday-modal-inner parent-home__live-quick-modal" +
                (quickModalIsSheet ? " parent-home__live-quick-modal--schedule" : "") +
                (scheduleModeKey ? ` parent-home__live-quick-modal--mode-${scheduleModeKey}` : "") +
                (quickModalIsPlanner ? " parent-home__live-quick-modal--mode-planner" : "") +
                (quickModalIsStudyRoom ? " parent-home__live-quick-modal--mode-study-room" : "")
              }
              role="dialog"
              aria-modal="true"
              aria-labelledby="parent-home-live-quick-modal-title"
              onClick={e => e.stopPropagation()}
            >
              <div
                className={
                  "dday-modal-header" +
                  (quickModalIsSheet ? " parent-home__live-quick-modal-header" : "")
                }
              >
                {quickModalIsStudyRoom ? (
                  <>
                    <p className="parent-home__live-quick-modal-eyebrow">
                      <span className="parent-home__live-quick-modal-eyebrow-dot" aria-hidden />
                      {STUDY_ROOM_SHEET_META.eyebrow}
                    </p>
                    <h2 id="parent-home-live-quick-modal-title" className="dday-modal-title">
                      {STUDY_ROOM_SHEET_META.title}
                    </h2>
                    <p className="parent-home__live-quick-modal-subtitle">{STUDY_ROOM_SHEET_META.subtitle}</p>
                  </>
                ) : quickModalIsPlanner ? (
                  <>
                    <p className="parent-home__live-quick-modal-eyebrow">
                      <span className="parent-home__live-quick-modal-eyebrow-dot" aria-hidden />
                      {PLANNER_SHEET_META.eyebrow}
                    </p>
                    <h2 id="parent-home-live-quick-modal-title" className="dday-modal-title">
                      {quickModalTitle}
                    </h2>
                    <p className="parent-home__live-quick-modal-subtitle">{PLANNER_SHEET_META.subtitle}</p>
                  </>
                ) : scheduleModeMeta ? (
                  <>
                    <p className="parent-home__live-quick-modal-eyebrow">
                      <span className="parent-home__live-quick-modal-eyebrow-dot" aria-hidden />
                      {scheduleModeMeta.eyebrow}
                    </p>
                    <h2 id="parent-home-live-quick-modal-title" className="dday-modal-title">
                      {quickModalTitle}
                    </h2>
                    <p className="parent-home__live-quick-modal-subtitle">{scheduleModeMeta.subtitle}</p>
                  </>
                ) : (
                  <h2 id="parent-home-live-quick-modal-title" className="dday-modal-title">
                    {quickModalTitle}
                  </h2>
                )}
              </div>
              <div
                className={
                  "dday-modal-body parent-home__live-quick-modal-body" +
                  (quickModalIsSheet ? " parent-home__live-quick-modal-body--schedule" : "")
                }
              >
                {quickModalIsStudyRoom && props.studyRoomQuickControls ? (
                  <StudyRoomPickerEditor
                    key={`study-room-${props.selectedStudent.id}-${quickModalReveal.revealed ? "open" : "closed"}`}
                    ref={studyRoomPanelRef}
                    variant="sheet"
                    hideFooter
                    student={{
                      id: props.selectedStudent.id,
                      email: props.selectedStudent.email
                    }}
                    initialValue={props.selectedStudent.studyRoom || undefined}
                    authToken={props.authToken}
                    saving={props.studyRoomQuickControls.saving}
                    onCanSaveChange={setStudyRoomCanSave}
                    onSave={value => {
                      void (async () => {
                        try {
                          await props.studyRoomQuickControls?.onSave(value);
                          closeQuickModal();
                        } catch {
                          /* onSave에서 안내 */
                        }
                      })();
                    }}
                  />
                ) : null}
                {quickModalIsPlanner && props.plannerQuickControls ? (
                  <ParentPlannerQuickPanel
                    ref={plannerPanelRef}
                    loading={props.plannerQuickControls.loading}
                    saving={props.plannerQuickControls.saving}
                    enabled={props.plannerQuickControls.enabled}
                    lockTime={props.plannerQuickControls.lockTime}
                    kioskActive={props.plannerQuickControls.kioskActive}
                    kioskActivating={props.plannerQuickControls.kioskActivating}
                    anyBusy={props.plannerQuickControls.anyBusy}
                    onToggleKioskNow={props.plannerQuickControls.onToggleKioskNow}
                    onSave={props.plannerQuickControls.onSave}
                    onBusyChange={setPlannerBusy}
                    onSaveComplete={closeQuickModal}
                  />
                ) : null}
                {scheduleModeKey && props.modeQuickControls ? (
                  <ParentModeQuickSchedulePanel
                    ref={schedulePanelRef}
                    apiBase={props.apiBase}
                    authToken={props.authToken}
                    studentId={props.selectedStudent?.id ?? null}
                    mode={scheduleModeKey}
                    active={
                      scheduleModeKey === "utility"
                        ? props.modeQuickControls.utility.active
                        : scheduleModeKey === "free"
                          ? props.modeQuickControls.free.active
                          : props.modeQuickControls.block.active
                    }
                    activating={
                      scheduleModeKey === "utility"
                        ? props.modeQuickControls.utility.activating
                        : scheduleModeKey === "free"
                          ? props.modeQuickControls.free.activating
                          : props.modeQuickControls.block.activating
                    }
                    anyBusy={props.modeQuickControls.anyBusy}
                    dangerWhenActive={scheduleModeKey === "block"}
                    onBusyChange={setScheduleBusy}
                    onToggleNow={
                      scheduleModeKey === "utility"
                        ? props.modeQuickControls.utility.onToggle
                        : scheduleModeKey === "free"
                          ? props.modeQuickControls.free.onToggle
                          : props.modeQuickControls.block.onToggle
                    }
                  />
                ) : null}
              </div>
              <div
                className={
                  "dday-modal-footer" +
                  (quickModalIsSheet ? " parent-home__live-quick-modal-footer" : "")
                }
              >
                {quickModalIsStudyRoom ? (
                  <>
                    <button
                      type="button"
                      className="modal-secondary parent-home__live-quick-modal-btn"
                      onClick={closeQuickModal}
                    >
                      {H.cancel}
                    </button>
                    <button
                      type="button"
                      className="modal-primary parent-home__live-quick-modal-btn"
                      disabled={!studyRoomCanSave || props.studyRoomQuickControls?.saving}
                      onClick={() => studyRoomPanelRef.current?.save()}
                    >
                      {props.studyRoomQuickControls?.saving
                        ? H.studyRoomQuickSaving
                        : H.studyRoomQuickSave}
                    </button>
                  </>
                ) : quickModalIsPlanner ? (
                  <>
                    <button
                      type="button"
                      className="modal-secondary parent-home__live-quick-modal-btn"
                      onClick={closeQuickModal}
                    >
                      {H.cancel}
                    </button>
                    <button
                      type="button"
                      className="modal-primary parent-home__live-quick-modal-btn"
                      disabled={
                        plannerBusy.loading ||
                        plannerBusy.saving ||
                        props.plannerQuickControls?.anyBusy
                      }
                      onClick={() => plannerPanelRef.current?.save()}
                    >
                      {plannerBusy.saving ? H.plannerQuickSaving : H.plannerQuickSave}
                    </button>
                  </>
                ) : quickModalIsSchedule ? (
                  <>
                    <button
                      type="button"
                      className="modal-secondary parent-home__live-quick-modal-btn"
                      onClick={closeQuickModal}
                    >
                      {H.cancel}
                    </button>
                    <button
                      type="button"
                      className="modal-primary parent-home__live-quick-modal-btn"
                      disabled={
                        scheduleBusy.loading ||
                        scheduleBusy.saving ||
                        props.modeQuickControls?.anyBusy
                      }
                      onClick={() => schedulePanelRef.current?.save()}
                    >
                      {scheduleBusy.saving ? H.modeScheduleSaving : H.modeScheduleSave}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="modal-secondary parent-home__live-quick-modal-btn"
                    onClick={closeQuickModal}
                  >
                    {H.cancel}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null}

    {locationCheckOpen
      ? createPortal(
          <div
            className={
              "dday-modal" + (locationCheckReveal.revealed ? " dday-modal--open" : "")
            }
            role="presentation"
            onClick={closeLocationCheckModal}
          >
            <div
              className="dday-modal-inner parent-home__location-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="parent-home-location-modal-title"
              onClick={e => e.stopPropagation()}
            >
              <div className="dday-modal-header parent-home__location-modal-head">
                <h2 id="parent-home-location-modal-title" className="dday-modal-title">
                  {H.liveLocationCheckModalTitle}
                </h2>
                <span
                  className={
                    "parent-home__net-badge" +
                    (props.studyRoomLive.currentWithinRadius === true
                      ? " parent-home__net-badge--on"
                      : props.studyRoomLive.currentWithinRadius === false
                        ? " parent-home__net-badge--off"
                        : "")
                  }
                >
                  {props.studyRoomLive.currentWithinRadius === true
                    ? H.liveLocationCheckWithin
                    : props.studyRoomLive.currentWithinRadius === false
                      ? H.liveLocationCheckOutside
                      : H.liveLocationCheckUnknown}
                </span>
              </div>
              <div className="dday-modal-body parent-home__location-modal-body">
                <>
                  <ParentHomeLocationCheckMap
                      live={props.studyRoomLive}
                      active={locationCheckReveal.revealed}
                    />
                    <div className="parent-home__location-modal-stats">
                      <div className="parent-home__location-stat">
                        <span className="parent-home__location-stat-label">
                          {H.liveLocationCheckDistanceLabel}
                        </span>
                        <span className="parent-home__location-stat-value">
                          {formatDistanceMeters(props.studyRoomLive.currentDistanceMeters)}
                        </span>
                      </div>
                      {props.studyRoomLive.currentRadiusMeters != null ? (
                        <div className="parent-home__location-stat">
                          <span className="parent-home__location-stat-label">
                            {H.liveLocationCheckRadiusLabel}
                          </span>
                          <span className="parent-home__location-stat-value">
                            {formatDistanceMeters(props.studyRoomLive.currentRadiusMeters)}
                          </span>
                        </div>
                      ) : null}
                      {props.studyRoomLive.currentAccuracyMeters != null ? (
                        <div className="parent-home__location-stat">
                          <span className="parent-home__location-stat-label">
                            {H.liveLocationCheckAccuracyLabel}
                          </span>
                          <span className="parent-home__location-stat-value">
                            {formatDistanceMeters(props.studyRoomLive.currentAccuracyMeters)}
                          </span>
                        </div>
                      ) : null}
                      <div className="parent-home__location-stat">
                        <span className="parent-home__location-stat-label">
                          {H.liveLocationCheckHeartbeatLabel}
                        </span>
                        <span className="parent-home__location-stat-value">
                          {formatSeoulDateTime(props.studyRoomLive.currentHeartbeatAt)}
                        </span>
                      </div>
                    </div>
                    {props.studyRoomLive.currentLatitude == null ||
                    props.studyRoomLive.currentLongitude == null ? (
                      <p className="parent-home__location-modal-note">
                        {H.liveLocationCheckNoStudentPosition}
                      </p>
                    ) : null}
                </>
              </div>
              <div className="dday-modal-footer parent-home__location-modal-footer">
                <button
                  type="button"
                  className={
                    "modal-secondary parent-home__location-modal-btn" +
                    (props.locationRefreshLoading ? " parent-home__location-modal-btn--loading" : "")
                  }
                  disabled={props.locationRefreshLoading}
                  aria-busy={props.locationRefreshLoading || undefined}
                  onClick={() => {
                    props.hapticSelection();
                    props.onRefreshLocation?.({ silent: false });
                  }}
                >
                  {props.locationRefreshLoading
                    ? H.liveLocationCheckModalRefreshing
                    : H.liveLocationCheckModalRefresh}
                </button>
                <button
                  type="button"
                  className="modal-primary parent-home__location-modal-btn"
                  onClick={closeLocationCheckModal}
                >
                  {H.liveLocationCheckModalClose}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null}

    {todayPlanOpen
      ? createPortal(
          <div
            className={"dday-modal" + (todayPlanReveal.revealed ? " dday-modal--open" : "")}
            role="presentation"
            onClick={closeTodayPlanModal}
          >
            <div
              className="dday-modal-inner parent-home__today-plan-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="parent-home-today-plan-modal-title"
              onClick={e => e.stopPropagation()}
            >
              <div className="dday-modal-header">
                <h2 id="parent-home-today-plan-modal-title" className="dday-modal-title">
                  {H.todayPlanModalTitle}
                </h2>
              </div>
              <div className="dday-modal-body parent-home__today-plan-modal-body">
                <ParentHomeTodayPlanModalBody
                  blocks={props.todayPlanBlocks}
                  reportLoaded={Boolean(props.parentReportLoaded)}
                  hasAnyWeekBlocks={props.hasAnyWeekPlanBlocks}
                />
              </div>
              <div
                className={
                  "dday-modal-footer parent-home__today-plan-modal-footer" +
                  (showTodayPlanRequestButton
                    ? " parent-home__today-plan-modal-footer--dual"
                    : "")
                }
              >
                {todayPlanRequestError ? (
                  <p className="parent-home__today-plan-modal-error" role="alert">
                    {todayPlanRequestError}
                  </p>
                ) : null}
                {showTodayPlanRequestButton ? (
                  <button
                    type="button"
                    className={
                      "modal-primary parent-home__today-plan-modal-btn" +
                      (todayPlanRequestSending ? " parent-home__today-plan-modal-btn--loading" : "")
                    }
                    disabled={!props.authToken || todayPlanRequestSending}
                    aria-busy={todayPlanRequestSending || undefined}
                    onClick={() => {
                      void requestTodayPlanViaChat();
                    }}
                  >
                    {todayPlanRequestSending ? H.todayPlanRequestSending : H.todayPlanRequestButton}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    (showTodayPlanRequestButton ? "modal-secondary" : "modal-primary") +
                    " parent-home__today-plan-modal-btn"
                  }
                  onClick={closeTodayPlanModal}
                >
                  {H.todayPlanModalClose}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null}
    </>
  );
}
