import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { AppConfig } from "@capacitor-community/mdm-appconfig";
import { persistApiBaseOverride } from "./lib/apiBase";
import { AppShell } from "./lib/nativeAppShell";
import "./styles.css";

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

function syncViewportCssVars() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const visualViewport = window.visualViewport;
  const layoutViewportHeight = Math.round(window.innerHeight);
  const visualViewportHeight = Math.round(
    (visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0)
  );
  const keyboardOpen =
    isFocusedEditableElement(document.activeElement) &&
    visualViewportHeight < layoutViewportHeight - 80;
  const viewportHeight = keyboardOpen
    ? layoutViewportHeight
    : Math.max(layoutViewportHeight, visualViewportHeight);

  document.documentElement.style.setProperty(
    "--app-viewport-height",
    `${viewportHeight}px`
  );
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

  syncViewportCssVars();

  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", scheduleSync);
  visualViewport?.addEventListener("scroll", scheduleSync);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("orientationchange", scheduleSync);
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
  await primeManagedApiBase();
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();

