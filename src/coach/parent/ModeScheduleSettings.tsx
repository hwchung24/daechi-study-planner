import React, { useEffect, useState } from "react";
import ModeScheduleGrid from "./ModeScheduleGrid";

const MODES = [
  { key: "utility", label: "유틸리티 모드", color: "#ffcc00" },
  { key: "free", label: "자유시간 모드", color: "#ff3b30" }
] as const;

const BLOCK_MODE = {
  key: "block" as const,
  label: "일괄 잠금 모드",
  color: "#334155"
};

type ModeKey = (typeof MODES)[number]["key"];

export default function ModeScheduleSettings(props: {
  activeMode?: ModeKey | null;
  onToggleModeNow?: (mode: ModeKey, nextEnabled: boolean) => void;
  activatingMode?: ModeKey | null;
  blockActive?: boolean;
  blockActivating?: boolean;
  onToggleBlockNow?: (nextLocked: boolean) => void;
  /** 부모 SectionHeader의 + 구간 추가와 연동 */
  scheduleModalOpen?: boolean;
  onScheduleModalClose?: () => void;
}) {
  const allModes = [...MODES, BLOCK_MODE];

  const anyActivating =
    Boolean(props.activatingMode) || Boolean(props.blockActivating);

  const showScheduleModal = Boolean(props.scheduleModalOpen);
  const [modalRendered, setModalRendered] = useState(showScheduleModal);
  const [modalAnimOpen, setModalAnimOpen] = useState(false);

  useEffect(() => {
    if (showScheduleModal) {
      setModalRendered(true);
    }
  }, [showScheduleModal]);

  useEffect(() => {
    if (!modalRendered) return;
    if (showScheduleModal) {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setModalAnimOpen(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setModalAnimOpen(false);
  }, [showScheduleModal, modalRendered]);

  useEffect(() => {
    if (showScheduleModal || modalAnimOpen || !modalRendered) return;
    const id = window.setTimeout(() => setModalRendered(false), 380);
    return () => clearTimeout(id);
  }, [showScheduleModal, modalAnimOpen, modalRendered]);

  return (
    <div className="parent-mode-schedule-list">
      {allModes.map(mode => {
        const isBlock = mode.key === "block";
        const rowActive = isBlock ? Boolean(props.blockActive) : props.activeMode === mode.key;
        const rowActivating = isBlock
          ? Boolean(props.blockActivating)
          : props.activatingMode === mode.key;
        return (
          <div key={mode.key} className="parent-settings-block">
            <div className="settings-item settings-item--stack student-profile-alarm-item student-profile-alarm-item--detail parent-mode-schedule-item">
              <div className="student-profile-alarm-item__row parent-mode-schedule-item__row">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label parent-mode-schedule-item__label">
                    {mode.label}
                  </span>
                  <span className="student-profile-alarm-item__copy">
                    {mode.label} 활성화 구간을 예약합니다.
                  </span>
                </span>
              </div>
            </div>
            <div className="parent-settings-primary-action">
              <button
                type="button"
                className={
                  "timeline-save-button study-room-editor__save-button parent-mode-schedule-item__activate" +
                  (isBlock && rowActive ? " student-profile-link-action-btn--danger" : "") +
                  (rowActivating ? " parent-settings-btn--spinner-only" : "")
                }
                disabled={anyActivating}
                onClick={() => {
                  if (isBlock) {
                    props.onToggleBlockNow?.(!rowActive);
                  } else {
                    props.onToggleModeNow?.(mode.key, props.activeMode !== mode.key);
                  }
                }}
                aria-busy={rowActivating}
                aria-label={rowActivating ? "처리 중" : rowActive ? "지금 끄기" : "지금 켜기"}
              >
                {rowActivating ? (
                  <span className="parent-settings-inline-spinner parent-settings-inline-spinner--inverse" aria-hidden />
                ) : rowActive ? (
                  "지금 끄기"
                ) : (
                  "지금 켜기"
                )}
              </button>
            </div>
          </div>
        );
      })}
      {modalRendered ? (
        <div
          className={
            "parent-mode-schedule-modal-backdrop" +
            (modalAnimOpen ? " parent-mode-schedule-modal-backdrop--open" : "")
          }
          onClick={() => props.onScheduleModalClose?.()}
        >
          <div
            className="parent-mode-schedule-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="parent-mode-schedule-modal__header">
              <span className="parent-mode-schedule-modal__title">허용앱 시간표 설정</span>
              <button
                type="button"
                className="parent-mode-schedule-modal__close"
                onClick={() => props.onScheduleModalClose?.()}
              >
                닫기
              </button>
            </div>
            <div className="parent-mode-schedule-modal__body">
              <p className="parent-mode-schedule-modal__lead">
                칠하기 모드를 고른 뒤, 표를 드래그해 구간을 채우거나 지웁니다.
              </p>
              <ModeScheduleGrid />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
