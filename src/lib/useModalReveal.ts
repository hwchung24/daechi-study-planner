import { useCallback, useEffect, useState } from "react";
import { MODAL_TRANSITION_MS } from "./uiTiming";

/**
 * 모달 마운트 후 `dday-modal--open` / `modal-backdrop--open` 을 한 틱 늦춰
 * 열림 트랜지션이 보이게 하고, 닫을 때는 클래스를 먼저 제거한 뒤 `MODAL_TRANSITION_MS` 후 언마운트합니다.
 */
export function useModalReveal(isOpen: boolean) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRevealed(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setRevealed(true));
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  const beginClose = useCallback((after: () => void) => {
    setRevealed(false);
    window.setTimeout(after, MODAL_TRANSITION_MS);
  }, []);

  return { revealed, beginClose };
}
