import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import ModeScheduleGrid, { type ModeScheduleModeKey, type ModeScheduleSlot } from "./ModeScheduleGrid";
import { ParentModeNowToggle } from "./ParentModeNowToggle";
import ko from "../fallbacks/ko.json";

const H = ko.parentHomeTab;

const MODE_LABEL: Record<ModeScheduleModeKey, string> = {
  utility: H.modeMoveOfficial,
  free: H.modeFreeOfficial,
  block: H.modeBlockOfficial
};

export type ParentModeQuickSchedulePanelHandle = {
  save: () => void;
};

export const ParentModeQuickSchedulePanel = forwardRef<
  ParentModeQuickSchedulePanelHandle,
  {
    apiBase: string;
    authToken: string | null;
    studentId: number | null;
    mode: ModeScheduleModeKey;
    active: boolean;
    activating: boolean;
    anyBusy: boolean;
    dangerWhenActive?: boolean;
    onToggleNow: () => void;
    onSaveComplete?: () => void;
    onBusyChange?: (busy: { saving: boolean; loading: boolean }) => void;
  }
>(function ParentModeQuickSchedulePanel(props, ref) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gridKey, setGridKey] = useState(0);
  const allSlotsRef = useRef<ModeScheduleSlot[]>([]);
  const modeSlotsRef = useRef<ModeScheduleSlot[]>([]);
  /** 서버 로드·gridKey 변경 시에만 갱신 — 편집 중에는 ref만 쓰고 initialSlots로 되돌리지 않음 */
  const [gridInitialSlots, setGridInitialSlots] = useState<ModeScheduleSlot[]>([]);

  const trackModeSlots = useCallback(
    (next: ModeScheduleSlot[]) => {
      modeSlotsRef.current = next.map(s => ({ ...s, mode: props.mode }));
    },
    [props.mode]
  );

  useEffect(() => {
    props.onBusyChange?.({ saving, loading });
  }, [loading, props.onBusyChange, saving]);

  useEffect(() => {
    if (!props.authToken || !props.studentId) {
      allSlotsRef.current = [];
      modeSlotsRef.current = [];
      setGridInitialSlots([]);
      setGridKey(k => k + 1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `${props.apiBase}/api/parent/students/${encodeURIComponent(String(props.studentId))}/app-mode-schedule`,
          { headers: { Authorization: `Bearer ${props.authToken}` } }
        );
        const data = (await res.json().catch(() => ({}))) as { slots?: unknown };
        if (cancelled) return;
        const all = Array.isArray(data.slots) ? (data.slots as ModeScheduleSlot[]) : [];
        allSlotsRef.current = all;
        const forMode = all.filter(s => s.mode === props.mode);
        modeSlotsRef.current = forMode;
        setGridInitialSlots(forMode);
        setGridKey(k => k + 1);
      } catch {
        if (!cancelled) {
          allSlotsRef.current = [];
          modeSlotsRef.current = [];
          setGridInitialSlots([]);
          setGridKey(k => k + 1);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.apiBase, props.authToken, props.mode, props.studentId, trackModeSlots]);

  const saveSchedule = async () => {
    if (!props.authToken || !props.studentId || saving) return;
    setSaving(true);
    try {
      const merged = [
        ...allSlotsRef.current.filter(s => s.mode !== props.mode),
        ...modeSlotsRef.current.map(s => ({ ...s, mode: props.mode }))
      ];
      const res = await fetch(
        `${props.apiBase}/api/parent/students/${encodeURIComponent(String(props.studentId))}/app-mode-schedule`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${props.authToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ slots: merged })
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(String(data.error || H.modeScheduleSaveFailed));
      }
      allSlotsRef.current = merged;
      const savedForMode = modeSlotsRef.current.map(s => ({ ...s, mode: props.mode }));
      setGridInitialSlots(savedForMode);
      props.onSaveComplete?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : H.modeScheduleSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: () => {
      void saveSchedule();
    }
  }));

  return (
    <div className="parent-mode-quick-sheet" data-mode={props.mode}>
      <section className="parent-mode-quick-sheet__section parent-mode-quick-sheet__section--now" aria-label={H.modeQuickNowSection}>
        <h3 className="parent-mode-quick-sheet__section-title">{H.modeQuickNowSection}</h3>
        <ParentModeNowToggle
          variant="sheet"
          modeLabel={MODE_LABEL[props.mode]}
          active={props.active}
          activating={props.activating}
          disabled={props.anyBusy || saving}
          dangerWhenActive={props.dangerWhenActive}
          onToggle={props.onToggleNow}
        />
      </section>

      <section
        className="parent-mode-quick-sheet__section parent-mode-quick-sheet__section--schedule"
        aria-label={H.modeQuickScheduleSection}
      >
        <div className="parent-mode-quick-sheet__section-head">
          <h3 className="parent-mode-quick-sheet__section-title">{H.modeQuickScheduleSection}</h3>
          <p className="parent-mode-quick-sheet__section-hint">{H.modeQuickScheduleHint}</p>
        </div>
        <div className="parent-mode-quick-sheet__schedule-panel">
          {loading ? (
            <p className="parent-mode-quick-sheet__loading">{H.modeScheduleLoading}</p>
          ) : (
            <ModeScheduleGrid
              key={gridKey}
              fixedMode={props.mode}
              initialSlots={gridInitialSlots}
              onSlotsChange={trackModeSlots}
            />
          )}
        </div>
      </section>
    </div>
  );
});

export type { ModeScheduleModeKey };
