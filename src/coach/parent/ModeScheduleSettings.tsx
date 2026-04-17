import React, { useState } from "react";
import ModeScheduleGrid from "./ModeScheduleGrid";

const MODES = [
  { key: "utility", label: "유틸리티 모드", color: "#ffcc00" },
  { key: "free", label: "자유시간 모드", color: "#ff3b30" }
] as const;

type ModeKey = (typeof MODES)[number]["key"];

export default function ModeScheduleSettings(props: {
  onActivateModeNow?: (mode: ModeKey) => void;
  activatingMode?: ModeKey | null;
}) {
  const [popup, setPopup] = useState<{ open: boolean; mode: ModeKey | null }>({
    open: false,
    mode: null
  });
  const selectedMode = MODES.find(mode => mode.key === popup.mode);

  return (
    <div className="parent-mode-schedule-list">
      {MODES.map(mode => (
        <div key={mode.key} className="parent-settings-block">
          <div className="settings-item settings-item--stack student-profile-alarm-item student-profile-alarm-item--detail parent-mode-schedule-item">
            <div className="student-profile-alarm-item__row parent-mode-schedule-item__row">
              <span className="student-profile-alarm-item__body">
                <span className="student-profile-alarm-item__label parent-mode-schedule-item__label">
                  {mode.label}
                </span>
                <span className="student-profile-alarm-item__copy">
                  {mode.label} 모드 활성화 구간을 예약합니다.
                </span>
              </span>
              <button
                type="button"
                className="student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button student-profile-alarm-item__toggle--on parent-mode-schedule-item__add"
                onClick={() => setPopup({ open: true, mode: mode.key })}
              >
                + 구간 추가
              </button>
            </div>
          </div>
          <div className="parent-settings-primary-action">
            <button
              type="button"
              className="timeline-save-button study-room-editor__save-button parent-mode-schedule-item__activate"
              disabled={Boolean(props.activatingMode)}
              onClick={() => props.onActivateModeNow?.(mode.key)}
            >
              {props.activatingMode === mode.key ? "적용 중..." : "지금 켜기"}
            </button>
          </div>
        </div>
      ))}
      {popup.open && (
        <div className="parent-mode-schedule-modal-backdrop" onClick={() => setPopup({ open: false, mode: null })}>
          <div
            className="parent-mode-schedule-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="parent-mode-schedule-modal__header">
              <span className="parent-mode-schedule-modal__title">
                {selectedMode?.label} 모드 시간표 설정
              </span>
              <button
                type="button"
                className="parent-mode-schedule-modal__close"
                onClick={() => setPopup({ open: false, mode: null })}
              >
                닫기
              </button>
            </div>
            <ModeScheduleGrid />
          </div>
        </div>
      )}
    </div>
  );
}
