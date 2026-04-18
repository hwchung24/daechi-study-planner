import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { AppConfig } from "@capacitor-community/mdm-appconfig";
import { persistApiBaseOverride } from "./lib/apiBase";
import { AppShell } from "./lib/nativeAppShell";
import "./styles.css";

type RuntimeErrorState = {
  error: Error | null;
};

class RuntimeErrorBoundary extends React.Component<
  React.PropsWithChildren,
  RuntimeErrorState
> {
  state: RuntimeErrorState = { error: null };

  static getDerivedStateFromError(error: Error): RuntimeErrorState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[app] render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily:
            '"SF Pro Text", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
        }}
      >
        <div
          style={{
            width: "min(720px, 100%)",
            borderRadius: "var(--radius-xl)",
            padding: "20px",
            background: "#ffffff",
            boxShadow: "0 18px 48px rgba(15, 23, 42, 0.12)"
          }}
        >
          <h1 style={{ margin: "0 0 12px", fontSize: "20px" }}>
            앱 실행 중 오류가 발생했습니다.
          </h1>
          <p style={{ margin: "0 0 12px", lineHeight: 1.6 }}>
            아래 메시지를 확인하면 흰 화면 원인을 바로 알 수 있습니다.
          </p>
          <pre
            style={{
              margin: 0,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              borderRadius: "var(--radius-button)",
              padding: "14px",
              background: "#0f172a",
              color: "#e2e8f0",
              fontSize: "13px",
              lineHeight: 1.5
            }}
          >
            {this.state.error.stack || this.state.error.message}
          </pre>
        </div>
      </div>
    );
  }
}

function renderBootstrapError(error: unknown) {
  console.error("[app] bootstrap failed", error);

  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  const message =
    error instanceof Error
      ? error.stack || error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error, null, 2);

  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;color:#0f172a;font-family:'SF Pro Text','Apple SD Gothic Neo','Noto Sans KR',sans-serif;">
      <div style="width:min(720px,100%);border-radius:var(--radius-xl);padding:20px;background:#ffffff;box-shadow:0 18px 48px rgba(15,23,42,0.12);">
        <h1 style="margin:0 0 12px;font-size:20px;">앱 시작 중 오류가 발생했습니다.</h1>
        <p style="margin:0 0 12px;line-height:1.6;">아래 메시지를 확인하면 흰 화면 원인을 바로 알 수 있습니다.</p>
        <pre style="margin:0;overflow-x:auto;white-space:pre-wrap;word-break:break-word;border-radius:var(--radius-button);padding:14px;background:#0f172a;color:#e2e8f0;font-size:13px;line-height:1.5;">${String(message).replace(/[&<>]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[char] || char))}</pre>
      </div>
    </div>
  `;
}

const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();
const NATIVE_KEYBOARD_STATE_EVENT = "daechi:native-keyboard-state";

let keyboardWasOpen = false;
let keyboardResetTimer = 0;
let keyboardScrollLockY = 0;
let lastTouchY = 0;
let keyboardStabilizeFrame = 0;
let keyboardStabilizeTimer = 0;
let nativeKeyboardOpen = false;
let nativeKeyboardHeight = 0;
let nativeKeyboardScrollDisabled = false;

function notifyNativeKeyboardState() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(NATIVE_KEYBOARD_STATE_EVENT, {
      detail: {
        open: nativeKeyboardOpen,
        height: nativeKeyboardHeight
      }
    })
  );
}

async function setNativeKeyboardScrollDisabled(disabled: boolean) {
  if (!IS_NATIVE_PLATFORM || nativeKeyboardScrollDisabled === disabled) {
    return;
  }

  nativeKeyboardScrollDisabled = disabled;
  try {
    await Keyboard.setScroll({ isDisabled: disabled });
  } catch {
    nativeKeyboardScrollDisabled = !disabled;
  }
}

function forceDocumentScrollTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function restoreKeyboardScrollPosition() {
  if (keyboardScrollLockY === 0) {
    forceDocumentScrollTop();
    return;
  }

  window.scrollTo(0, keyboardScrollLockY);
  document.documentElement.scrollTop = keyboardScrollLockY;
  document.body.scrollTop = keyboardScrollLockY;
}

const EDITABLE_SELECTOR = [
  'input:not([type="button"]):not([type="checkbox"]):not([type="file"]):not([type="hidden"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"])',
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]'
].join(", ");

function isFocusedEditableElement(node: Element | null): node is HTMLElement {
  return node instanceof HTMLElement && node.matches(EDITABLE_SELECTOR);
}

function findScrollableAncestor(node: EventTarget | null): HTMLElement | null {
  let current = node instanceof HTMLElement ? node : null;

  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const canScrollY =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight + 1;

    if (canScrollY) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function canScrollWithin(element: HTMLElement, deltaY: number) {
  if (Math.abs(deltaY) < 0.5) {
    return true;
  }

  if (deltaY > 0) {
    return element.scrollTop > 0;
  }

  return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
}

function setKeyboardScrollLock(active: boolean) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const bodyStyle = document.body.style;

  if (active) {
    keyboardScrollLockY = 0;
    forceDocumentScrollTop();
    bodyStyle.position = "fixed";
    bodyStyle.top = "0";
    bodyStyle.left = "0";
    bodyStyle.right = "0";
    bodyStyle.width = "100%";
    bodyStyle.overflow = "hidden";
    return;
  }

  bodyStyle.position = "";
  bodyStyle.top = "";
  bodyStyle.left = "";
  bodyStyle.right = "";
  bodyStyle.width = "";
  bodyStyle.overflow = "";

  restoreKeyboardScrollPosition();
}

function syncViewportCssVars() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  if (IS_NATIVE_PLATFORM) {
    const viewportHeight = Math.round(window.innerHeight);
    const keyboardOpen = nativeKeyboardOpen;

    document.documentElement.style.setProperty(
      "--app-viewport-height",
      `${viewportHeight}px`
    );
    document.documentElement.style.setProperty("--app-viewport-offset-top", "0px");
    document.documentElement.style.setProperty(
      "--native-keyboard-height",
      `${Math.max(0, Math.round(nativeKeyboardHeight))}px`
    );
    document.documentElement.classList.toggle("app-keyboard-open", keyboardOpen);
    document.body.classList.toggle("app-keyboard-open", keyboardOpen);

    if (keyboardOpen && !keyboardWasOpen) {
      window.clearTimeout(keyboardResetTimer);
      keyboardResetTimer = 0;
      setKeyboardScrollLock(true);
    }

    if (keyboardOpen) {
      forceDocumentScrollTop();
    }

    if (!keyboardOpen && keyboardWasOpen) {
      setKeyboardScrollLock(false);

      const resetScroll = () => {
        restoreKeyboardScrollPosition();
      };

      resetScroll();
      window.requestAnimationFrame(() => {
        resetScroll();
        window.requestAnimationFrame(resetScroll);
      });

      window.clearTimeout(keyboardResetTimer);
      keyboardResetTimer = window.setTimeout(() => {
        resetScroll();
        keyboardResetTimer = 0;
        keyboardScrollLockY = 0;
      }, 180);
    }

    keyboardWasOpen = keyboardOpen;
    notifyNativeKeyboardState();
    return;
  }

  const visualViewport = window.visualViewport;
  const layoutViewportHeight = Math.round(window.innerHeight);
  const visualViewportHeight = Math.round(
    (visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0)
  );
  const keyboardOpen =
    isFocusedEditableElement(document.activeElement) &&
    visualViewportHeight < layoutViewportHeight - 120;
  const viewportHeight = keyboardOpen
    ? layoutViewportHeight
    : Math.max(layoutViewportHeight, visualViewportHeight);

  document.documentElement.style.setProperty(
    "--app-viewport-height",
    `${viewportHeight}px`
  );
  document.documentElement.style.setProperty(
    "--app-viewport-offset-top",
    "0px"
  );
  document.documentElement.classList.toggle("app-keyboard-open", keyboardOpen);
  document.body.classList.toggle("app-keyboard-open", keyboardOpen);

  if (keyboardOpen && !keyboardWasOpen) {
    window.clearTimeout(keyboardResetTimer);
    keyboardResetTimer = 0;
    setKeyboardScrollLock(true);
  }

  if (keyboardOpen) {
    forceDocumentScrollTop();
  }

  if (!keyboardOpen && keyboardWasOpen) {
    setKeyboardScrollLock(false);

    const resetScroll = () => {
      restoreKeyboardScrollPosition();
    };

    resetScroll();
    window.requestAnimationFrame(() => {
      resetScroll();
      window.requestAnimationFrame(resetScroll);
    });

    window.clearTimeout(keyboardResetTimer);
    keyboardResetTimer = window.setTimeout(() => {
      resetScroll();
      keyboardResetTimer = 0;
      keyboardScrollLockY = 0;
    }, 180);
  }

  keyboardWasOpen = keyboardOpen;
}

function installViewportCssVars() {
  if (typeof window === "undefined") return;

  let frame = 0;
  const scheduleSync = () => {
    if (frame) {
      window.cancelAnimationFrame(frame);
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      syncViewportCssVars();
    });
  };

  const stopKeyboardStabilization = () => {
    if (keyboardStabilizeFrame) {
      window.cancelAnimationFrame(keyboardStabilizeFrame);
      keyboardStabilizeFrame = 0;
    }
    if (keyboardStabilizeTimer) {
      window.clearTimeout(keyboardStabilizeTimer);
      keyboardStabilizeTimer = 0;
    }
  };

  const stabilizeKeyboardViewport = () => {
    stopKeyboardStabilization();

    let remainingFrames = 2;
    const tick = () => {
      forceDocumentScrollTop();
      syncViewportCssVars();
      if (remainingFrames > 0) {
        remainingFrames -= 1;
        keyboardStabilizeFrame = window.requestAnimationFrame(tick);
        return;
      }
      keyboardStabilizeFrame = 0;
    };

    keyboardStabilizeFrame = window.requestAnimationFrame(tick);
    keyboardStabilizeTimer = window.setTimeout(() => {
      forceDocumentScrollTop();
      syncViewportCssVars();
      keyboardStabilizeTimer = 0;
    }, 120);
  };

  const keepScrollLocked = () => {
    if (!keyboardWasOpen) {
      return;
    }

    restoreKeyboardScrollPosition();
    scheduleSync();
  };

  const onVisualViewportChange = () => {
    if (isFocusedEditableElement(document.activeElement)) {
      forceDocumentScrollTop();
      scheduleSync();
      return;
    }

    scheduleSync();
  };

  const onTouchStart = (event: TouchEvent) => {
    lastTouchY = event.touches[0]?.clientY ?? 0;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!keyboardWasOpen) {
      return;
    }

    const touchY = event.touches[0]?.clientY ?? lastTouchY;
    const deltaY = touchY - lastTouchY;
    lastTouchY = touchY;

    const scrollableAncestor = findScrollableAncestor(event.target);
    if (!scrollableAncestor || !canScrollWithin(scrollableAncestor, deltaY)) {
      event.preventDefault();
      restoreKeyboardScrollPosition();
    }
  };

  const onWheel = (event: WheelEvent) => {
    if (!keyboardWasOpen) {
      return;
    }

    const scrollableAncestor = findScrollableAncestor(event.target);
    if (!scrollableAncestor || !canScrollWithin(scrollableAncestor, -event.deltaY)) {
      event.preventDefault();
      restoreKeyboardScrollPosition();
    }
  };

  syncViewportCssVars();

  if (IS_NATIVE_PLATFORM) {
    const keyboardShowListener = Keyboard.addListener("keyboardWillShow", event => {
      nativeKeyboardOpen = true;
      nativeKeyboardHeight = event.keyboardHeight;
      void setNativeKeyboardScrollDisabled(true);
      forceDocumentScrollTop();
      scheduleSync();
    });

    const keyboardDidShowListener = Keyboard.addListener("keyboardDidShow", event => {
      nativeKeyboardOpen = true;
      nativeKeyboardHeight = event.keyboardHeight;
      void setNativeKeyboardScrollDisabled(true);
      forceDocumentScrollTop();
      scheduleSync();
    });

    const keyboardHideListener = Keyboard.addListener("keyboardWillHide", () => {
      nativeKeyboardOpen = false;
      nativeKeyboardHeight = 0;
      void setNativeKeyboardScrollDisabled(false);
      scheduleSync();
    });

    const keyboardDidHideListener = Keyboard.addListener("keyboardDidHide", () => {
      nativeKeyboardOpen = false;
      nativeKeyboardHeight = 0;
      void setNativeKeyboardScrollDisabled(false);
      forceDocumentScrollTop();
      scheduleSync();
    });

    void Keyboard.setResizeMode({ mode: "none" }).catch(() => {
      // ignore: older bridge/plugin edge cases should fall back to config-level behavior
    });
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {
      // ignore: not all devices/runtime combinations expose accessory bar control consistently
    });
    void setNativeKeyboardScrollDisabled(false);

    document.addEventListener(
      "focusin",
      () => {
        forceDocumentScrollTop();
        scheduleSync();
      },
      true
    );
    document.addEventListener("focusout", scheduleSync, true);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("scroll", keepScrollLocked, { passive: true });
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true
    });
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return;
  }

  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", onVisualViewportChange);
  visualViewport?.addEventListener("scroll", onVisualViewportChange);
  document.addEventListener(
    "focusin",
    () => {
      forceDocumentScrollTop();
      stabilizeKeyboardViewport();
    },
    true
  );
  document.addEventListener(
    "focusout",
    () => {
      stopKeyboardStabilization();
      scheduleSync();
    },
    true
  );
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, {
    passive: false,
    capture: true
  });
  document.addEventListener("wheel", onWheel, { passive: false, capture: true });
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("orientationchange", scheduleSync);
  window.addEventListener("scroll", keepScrollLocked, { passive: true });
}

installViewportCssVars();

function installNativeConnectivityModeSync() {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;

  const isRemoteHttpPage = () => {
    const protocol = String(window.location.protocol || "").toLowerCase();
    return protocol === "http:" || protocol === "https:";
  };

  const switchToBundledAssets = async () => {
    if (!isRemoteHttpPage()) return;
    try {
      await AppShell.switchToBundledAssets({
        kind: "offline",
        message: "인터넷 연결이 끊겨 오프라인 모드로 전환되었습니다."
      });
    } catch {
      // ignore: if the bridge is not ready or transition fails, keep current page
    }
  };

  const switchToRemoteIfAvailable = async () => {
    if (isRemoteHttpPage()) return;
    try {
      await AppShell.switchToRemoteIfAvailable({
        kind: "online",
        message: "인터넷 연결이 복구되어 온라인 모드로 전환되었습니다."
      });
    } catch {
      // ignore: remain on bundled assets when remote switching is unavailable
    }
  };

  window.addEventListener("offline", () => {
    void switchToBundledAssets();
  });

  window.addEventListener("online", () => {
    void switchToRemoteIfAvailable();
  });
}

installNativeConnectivityModeSync();

async function primeManagedApiBase() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    for (const key of ["api_base", "apiBase"]) {
      const result = await AppConfig.getValue({ key });
      const value = String(result?.value || "").trim();
      if (!value) continue;
      persistApiBaseOverride(value);
      return;
    }
  } catch {
    // ignore: unmanaged install path or plugin unavailable
  }
}

async function bootstrap() {
  void primeManagedApiBase();
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <RuntimeErrorBoundary>
        <App />
      </RuntimeErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap().catch(renderBootstrapError);

