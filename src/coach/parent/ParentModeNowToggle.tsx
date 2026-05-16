import React from "react";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const H = ko.parentHomeTab;

export function ParentModeNowToggle(props: {
  modeLabel: string;
  hint?: string;
  active: boolean;
  activating: boolean;
  disabled?: boolean;
  dangerWhenActive?: boolean;
  variant?: "default" | "sheet";
  onToggle: () => void;
}) {
  const hint = props.hint ?? tpl(H.modeScheduleActivateHint, { label: props.modeLabel });
  const variant = props.variant ?? "default";

  if (variant === "sheet") {
    const btnClass =
      "parent-mode-now-toggle__sheet-btn" +
      (props.active ? " parent-mode-now-toggle__sheet-btn--active" : "") +
      (props.dangerWhenActive && props.active ? " parent-mode-now-toggle__sheet-btn--danger" : "") +
      (props.activating ? " parent-mode-now-toggle__sheet-btn--busy" : "");

    return (
      <div className="parent-mode-now-toggle parent-mode-now-toggle--sheet">
        <div className="parent-mode-now-toggle__sheet-copy">
          <span className="parent-mode-now-toggle__sheet-label">{props.modeLabel}</span>
          <span className="parent-mode-now-toggle__sheet-hint">{hint}</span>
        </div>
        <button
          type="button"
          className={btnClass}
          disabled={props.disabled}
          onClick={props.onToggle}
          aria-busy={props.activating}
          aria-label={
            props.activating ? H.modeNowActivatingAria : props.active ? H.plannerBulkOff : H.plannerBulkOn
          }
        >
          {props.activating ? (
            <span className="parent-settings-inline-spinner parent-settings-inline-spinner--inverse" aria-hidden />
          ) : props.active ? (
            H.plannerBulkOff
          ) : (
            H.plannerBulkOn
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="parent-mode-now-toggle">
      <div className="settings-item settings-item--stack student-profile-alarm-item student-profile-alarm-item--detail parent-mode-schedule-item">
        <div className="student-profile-alarm-item__row parent-mode-schedule-item__row">
          <span className="student-profile-alarm-item__body">
            <span className="student-profile-alarm-item__label parent-mode-schedule-item__label">
              {props.modeLabel}
            </span>
            <span className="student-profile-alarm-item__copy">{hint}</span>
          </span>
        </div>
      </div>
      <div className="parent-settings-primary-action">
        <button
          type="button"
          className={
            "timeline-save-button study-room-editor__save-button parent-mode-schedule-item__activate" +
            (props.dangerWhenActive && props.active ? " student-profile-link-action-btn--danger" : "") +
            (props.activating ? " parent-settings-btn--spinner-only" : "")
          }
          disabled={props.disabled}
          onClick={props.onToggle}
          aria-busy={props.activating}
          aria-label={
            props.activating ? H.modeNowActivatingAria : props.active ? H.plannerBulkOff : H.plannerBulkOn
          }
        >
          {props.activating ? (
            <span className="parent-settings-inline-spinner parent-settings-inline-spinner--inverse" aria-hidden />
          ) : props.active ? (
            H.plannerBulkOff
          ) : (
            H.plannerBulkOn
          )}
        </button>
      </div>
    </div>
  );
}
