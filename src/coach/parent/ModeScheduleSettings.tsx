import React, { useCallback, useRef, useState } from "react";
import { useModalReveal } from "../../lib/useModalReveal";
import ModeScheduleGrid, { type ModeScheduleSlot } from "./ModeScheduleGrid";
import { ParentModeNowToggle } from "./ParentModeNowToggle";

const MODES = [
  { key: "utility", label: "유틸리티 모드", color: "#ffcc00" },
  { key: "free", label: "자유시간 모드", color: "#ff3b30" }
] as const;

const BLOCK_MODE = {
  key: "block" as const,
  label: "일괄 차단 모드",
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
  /** 모달을 열 때 복원할 구간(저장본 등) */
  initialScheduleSlots?: ModeScheduleSlot[] | null;
  /** 서버에서 불러온 뒤 그리드 재마운트용 */
  scheduleGridRemountKey?: number;
  /** 저장 — 성공 시 모달이 닫힙니다. 실패 시 `throw` 하면 모달은 유지됩니다. */
  onScheduleSave?: (slots: ModeScheduleSlot[]) => void | Promise<void>;
}) {
  const allModes = [...MODES, BLOCK_MODE];

  const anyActivating =
    Boolean(props.activatingMode) || Boolean(props.blockActivating);

  const scheduleModalReveal = useModalReveal(Boolean(props.scheduleModalOpen));

  const slotsRef = useRef<ModeScheduleSlot[]>([]);
  const trackSlots = useCallback((next: ModeScheduleSlot[]) => {
    slotsRef.current = next;
  }, []);

  const [saveBusy, setSaveBusy] = useState(false);

  const closeScheduleModal = () => {
    scheduleModalReveal.beginClose(() => props.onScheduleModalClose?.());
  };

  const saveSchedule = async () => {
    if (saveBusy) return;
    if (!props.onScheduleSave) {
      closeScheduleModal();
      return;
    }
    setSaveBusy(true);
    try {
      await props.onScheduleSave(slotsRef.current);
      closeScheduleModal();
    } catch {
      /* 부모가 메시지를 띄움; 모달 유지 */
    } finally {
      setSaveBusy(false);
    }
  };

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
            <ParentModeNowToggle
              modeLabel={mode.label}
              active={rowActive}
              activating={rowActivating}
              disabled={anyActivating}
              dangerWhenActive={isBlock}
              onToggle={() => {
                if (isBlock) {
                  props.onToggleBlockNow?.(!rowActive);
                } else {
                  props.onToggleModeNow?.(mode.key, props.activeMode !== mode.key);
                }
              }}
            />
          </div>
        );
      })}
      {props.scheduleModalOpen ? (
        <div
          className={
            "dday-modal parent-mode-schedule-modal" +
            (scheduleModalReveal.revealed ? " dday-modal--open" : "")
          }
          onClick={closeScheduleModal}
        >
          <div
            className="dday-modal-inner dday-modal-inner--parent-mode-schedule"
            onClick={e => e.stopPropagation()}
          >
            <div className="dday-modal-header">
              <span className="dday-modal-title">허용앱 시간표 설정</span>
            </div>
            <div className="dday-modal-body dday-modal-body--scroll-fill parent-mode-schedule-modal__body">
              <ModeScheduleGrid
                key={props.scheduleGridRemountKey ?? 0}
                initialSlots={props.initialScheduleSlots ?? undefined}
                onSlotsChange={trackSlots}
              />
            </div>
            <div className="dday-modal-footer parent-mode-schedule-modal__footer">
              <button
                type="button"
                className="modal-secondary"
                onClick={closeScheduleModal}
                disabled={saveBusy}
              >
                닫기
              </button>
              <button
                type="button"
                className="modal-primary"
                onClick={() => void saveSchedule()}
                disabled={saveBusy}
              >
                {saveBusy ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
