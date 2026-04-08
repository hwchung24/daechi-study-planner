import { useEffect } from "react";
import type { RefObject } from "react";

const NATIVE_KEYBOARD_STATE_EVENT = "daechi:native-keyboard-state";

type KeyboardDockInsetOptions = {
  rootRef: RefObject<HTMLElement>;
  scrollerRef?: RefObject<HTMLElement>;
  dockRef: RefObject<HTMLElement>;
  gap?: number;
};

const EDITABLE_SELECTOR = [
  'input:not([type="button"]):not([type="checkbox"]):not([type="file"]):not([type="hidden"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"])',
  "textarea",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]'
].join(", ");

function getViewportBottom() {
  if (typeof window === "undefined") return 0;
  const vv = window.visualViewport;
  return vv ? vv.height + vv.offsetTop : window.innerHeight;
}

function getNativeKeyboardHeight() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }

  const rawValue = document.documentElement.style.getPropertyValue("--native-keyboard-height");
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isEditableElement(root: HTMLElement, node: EventTarget | null): node is HTMLElement {
  return node instanceof HTMLElement && root.contains(node) && node.matches(EDITABLE_SELECTOR);
}

export function useKeyboardDockInset(options: KeyboardDockInsetOptions) {
  const { rootRef, scrollerRef, dockRef, gap = 12 } = options;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = rootRef.current;
    const dock = dockRef.current;
    if (!root || !dock) return;
    const shell = root.closest(".app-shell");

    let frame = 0;
    let timeoutId = 0;
    let baselineViewportBottom = getViewportBottom();

    const applyValues = (keyboardInset: number, dockLift: number) => {
      const active = keyboardInset > 0 || dockLift > 0;
      root.style.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
      root.style.setProperty("--keyboard-lift", `${Math.round(dockLift)}px`);
      root.classList.toggle("keyboard-dock--active", active);
      shell?.classList.toggle("app-shell--keyboard-dock-active", active);
      scrollerRef?.current?.classList.toggle(
        "keyboard-dock-scroller--active",
        active
      );
    };

    const sync = () => {
      frame = 0;
      const viewportBottom = getViewportBottom();
      const activeElement = document.activeElement;
      const activeEditable = isEditableElement(root, activeElement);
      const nativeKeyboardHeight = getNativeKeyboardHeight();
      const effectiveViewportBottom = nativeKeyboardHeight > 0
        ? window.innerHeight - nativeKeyboardHeight
        : viewportBottom;

      if (!activeEditable || effectiveViewportBottom >= baselineViewportBottom - 24) {
        baselineViewportBottom = effectiveViewportBottom;
      }

      const keyboardInset = activeEditable
        ? Math.max(
            0,
            Math.max(baselineViewportBottom - effectiveViewportBottom, nativeKeyboardHeight)
          )
        : 0;

      let dockLift = 0;
      if (activeEditable) {
        const activeRect = activeElement.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        const visibleBottom = effectiveViewportBottom - gap;
        const targetBottom = Math.max(activeRect.bottom, dockRect.bottom);
        dockLift = keyboardInset > 0 ? Math.max(0, Math.min(targetBottom - visibleBottom, keyboardInset)) : 0;
      }

      applyValues(keyboardInset, dockLift);
    };

    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(sync);
      }, 140);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (isEditableElement(root, event.target)) {
        scheduleSync();
      }
    };

    const onFocusOut = () => {
      scheduleSync();
    };

    const vv = window.visualViewport;
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener(NATIVE_KEYBOARD_STATE_EVENT, scheduleSync);
    vv?.addEventListener("resize", scheduleSync);
    vv?.addEventListener("scroll", scheduleSync);
    window.addEventListener("resize", scheduleSync);
    scheduleSync();

    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener(NATIVE_KEYBOARD_STATE_EVENT, scheduleSync);
      vv?.removeEventListener("resize", scheduleSync);
      vv?.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      window.clearTimeout(timeoutId);
      if (frame) window.cancelAnimationFrame(frame);
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--keyboard-lift");
      root.classList.remove("keyboard-dock--active");
      shell?.classList.remove("app-shell--keyboard-dock-active");
      scrollerRef?.current?.classList.remove("keyboard-dock-scroller--active");
    };
  }, [dockRef, gap, rootRef, scrollerRef]);
}