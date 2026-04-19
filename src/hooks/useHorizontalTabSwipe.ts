import { useCallback, useRef } from "react";

const DEFAULT_THRESHOLD_PX = 56;
const HORIZONTAL_DOMINANCE = 1.35;

/**
 * 수평 스와이프만 감지해 콜백 호출 (세로 스크롤·내부 가로 스크롤 영역은 무시).
 * 왼쪽으로 밀면 direction "left", 오른쪽으로 밀면 "right".
 */
export function useHorizontalTabSwipe(options: {
  enabled: boolean;
  onSwipe: (direction: "left" | "right") => void;
  /** touchstart 타깃이 이 셀렉터에 매치되면 제스처 무시 */
  ignoreStartWithinSelector?: string;
  thresholdPx?: number;
}) {
  const {
    enabled,
    onSwipe,
    ignoreStartWithinSelector = ".today-cards-scroll, .progress-cards-scroll, [data-disable-tab-swipe]",
    thresholdPx = DEFAULT_THRESHOLD_PX
  } = options;

  const startX = useRef(0);
  const startY = useRef(0);
  const startIgnored = useRef(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (ignoreStartWithinSelector && t.closest(ignoreStartWithinSelector)) {
        startIgnored.current = true;
        return;
      }
      startIgnored.current = false;
      const p = e.changedTouches[0] ?? e.touches[0];
      if (!p) return;
      startX.current = p.clientX;
      startY.current = p.clientY;
    },
    [enabled, ignoreStartWithinSelector]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || startIgnored.current) return;
      const p = e.changedTouches[0];
      if (!p) return;
      const dx = p.clientX - startX.current;
      const dy = p.clientY - startY.current;
      if (Math.abs(dx) < thresholdPx) return;
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_DOMINANCE) return;
      if (dx < 0) onSwipe("left");
      else onSwipe("right");
    },
    [enabled, onSwipe, thresholdPx]
  );

  return { onTouchStart, onTouchEnd };
}
