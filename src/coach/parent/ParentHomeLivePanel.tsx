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
import type { ParentMdmSurfaceMode } from "./parentDeviceModeDisplay";
import {
  elapsedMinutesFromIso,
  formatElapsedMinutesKo,
  formatSeoulClockNow,
  todayVisitContext
} from "./parentHomeMetrics";
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
  utility: { eyebrow: H.modeUtilityOfficial, subtitle: ME.utility },
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
  onRecheckNet: () => void;
  hasStudyRoomConfig: boolean;
  studyRoomVisitsLoading: boolean;
  studyRoomName: string | null;
  studyRoomWithinRadius: boolean | undefined;
  todayVisits: StudyRoomVisitSession[];
  displaySurfaceMode: ParentMdmSurfaceMode | null;
  currentStudyDisplay: CurrentStudyDisplay;
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
  const quickModalReveal = useModalReveal(quickModalId != null);
  const quickModalTitle = QUICK_MODALS.find(m => m.id === quickModalId)?.label ?? "";

  const closeQuickModal = () => {
    quickModalReveal.beginClose(() => setQuickModalId(null));
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
    return ME[props.displaySurfaceMode as keyof typeof ME] || ME.default;
  }, [props.displaySurfaceMode]);

  const studyLine = useMemo(() => {
    if (props.currentStudyDisplay.kind === "loading") return H.loadingStudySchedule;
    if (props.currentStudyDisplay.kind === "active") {
      return tpl(H.statusHeroStudyingNow, { subject: props.currentStudyDisplay.text });
    }
    const text = props.currentStudyDisplay.text;
    if (text === H.noStudySchedule) return H.statusHeroStudyNoSchedule;
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
                className="parent-home__chip-btn parent-home__chip-btn--sm"
                onClick={props.onRecheckNet}
              >
                <RefreshCw size={14} aria-hidden />
                {H.statusHeroRecheckNet}
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
          below={locationBelow}
        />
        <LiveRow icon={<BookOpen size={16} strokeWidth={2} />} title={H.plannerTitle} status={studyLine} />
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
    </>
  );
}
