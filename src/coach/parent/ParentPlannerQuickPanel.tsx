import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { TimePickerInline } from "../../components/TimePickerSheet";
import { ParentModeNowToggle } from "./ParentModeNowToggle";
import ko from "../fallbacks/ko.json";

const H = ko.parentHomeTab;

export type ParentPlannerQuickPanelHandle = {
  save: () => void;
};

export const ParentPlannerQuickPanel = forwardRef<
  ParentPlannerQuickPanelHandle,
  {
    loading: boolean;
    saving: boolean;
    enabled: boolean;
    lockTime: string;
    kioskActive: boolean;
    kioskActivating: boolean;
    anyBusy: boolean;
    onToggleKioskNow: () => void;
    onSave: (next: { enabled: boolean; lockTime: string }) => void | Promise<void>;
    onBusyChange?: (busy: { saving: boolean; loading: boolean }) => void;
    onSaveComplete?: () => void;
  }
>(function ParentPlannerQuickPanel(props, ref) {
  const [draftEnabled, setDraftEnabled] = useState(props.enabled);
  const [draftLockTime, setDraftLockTime] = useState(props.lockTime);
  const [localSaving, setLocalSaving] = useState(false);

  useEffect(() => {
    if (props.loading) return;
    setDraftEnabled(props.enabled);
    setDraftLockTime(props.lockTime);
  }, [props.enabled, props.loading, props.lockTime]);

  useEffect(() => {
    props.onBusyChange?.({ saving: props.saving || localSaving, loading: props.loading });
  }, [localSaving, props.loading, props.onBusyChange, props.saving]);

  const savePlanner = async () => {
    if (props.loading || props.saving || localSaving) return;
    setLocalSaving(true);
    try {
      await props.onSave({ enabled: draftEnabled, lockTime: draftLockTime });
      props.onSaveComplete?.();
    } catch {
      /* savePlannerRule에서 안내 */
    } finally {
      setLocalSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: () => {
      void savePlanner();
    }
  }));

  const busy = props.anyBusy || props.saving || localSaving;

  return (
    <div className="parent-mode-quick-sheet parent-planner-quick-sheet">
      <section className="parent-mode-quick-sheet__section parent-mode-quick-sheet__section--now" aria-label={H.modeQuickNowSection}>
        <h3 className="parent-mode-quick-sheet__section-title">{H.modeQuickNowSection}</h3>
        <ParentModeNowToggle
          variant="sheet"
          modeLabel={H.plannerQuickNowLabel}
          hint={H.plannerQuickNowHint}
          active={props.kioskActive}
          activating={props.kioskActivating}
          disabled={busy || props.loading}
          onToggle={props.onToggleKioskNow}
        />
      </section>

      <section
        className="parent-mode-quick-sheet__section parent-mode-quick-sheet__section--schedule"
        aria-label={H.modeQuickPlannerSection}
      >
        <div className="parent-mode-quick-sheet__section-head">
          <h3 className="parent-mode-quick-sheet__section-title">{H.modeQuickPlannerSection}</h3>
          <p className="parent-mode-quick-sheet__section-hint">{H.plannerQuickScheduleHint}</p>
        </div>
        <div className="parent-mode-quick-sheet__schedule-panel parent-planner-quick-sheet__rule-panel">
          {props.loading ? (
            <p className="parent-mode-quick-sheet__loading">{H.loadingPlannerSettings}</p>
          ) : (
            <>
              <div className="parent-planner-quick-sheet__auto-row">
                <div className="parent-planner-quick-sheet__auto-copy">
                  <span className="parent-planner-quick-sheet__auto-label">{H.plannerQuickAutoLabel}</span>
                  <span className="parent-planner-quick-sheet__auto-hint">{H.plannerQuickAutoHint}</span>
                </div>
                <button
                  type="button"
                  className={
                    "parent-planner-quick-sheet__auto-btn" +
                    (draftEnabled ? " parent-planner-quick-sheet__auto-btn--on" : "")
                  }
                  disabled={busy}
                  aria-pressed={draftEnabled}
                  onClick={() => setDraftEnabled(v => !v)}
                >
                  {draftEnabled ? H.timeSettingOn : H.timeSettingOff}
                </button>
              </div>
              <div
                className={
                  "parent-planner-quick-sheet__time-block" +
                  (draftEnabled ? "" : " parent-planner-quick-sheet__time-block--disabled")
                }
              >
                <span className="parent-planner-quick-sheet__time-label">{H.plannerQuickTimeLabel}</span>
                <TimePickerInline
                  value={draftLockTime}
                  onChange={setDraftLockTime}
                />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
});
