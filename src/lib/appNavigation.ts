import { Capacitor } from "@capacitor/core";

const APP_PATH_CHANGE_EVENT = "daechi:app-path-change";

let nativeAppPath = "#/";

function normalizeAppPath(path: string | null | undefined): string {
  const raw = String(path ?? "").trim();
  if (!raw) return "#/";
  if (raw.startsWith("#")) return raw;
  return `#${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export function getAppPath(): string {
  if (typeof window === "undefined") return nativeAppPath;
  if (isNativeShell()) return nativeAppPath;
  return normalizeAppPath(window.location.hash);
}

function emitNativePathChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_PATH_CHANGE_EVENT, {
    detail: { path: nativeAppPath }
  }));
}

export function setAppPath(path: string) {
  const nextPath = normalizeAppPath(path);
  if (typeof window === "undefined") {
    nativeAppPath = nextPath;
    return;
  }
  if (isNativeShell()) {
    if (nativeAppPath === nextPath) return;
    nativeAppPath = nextPath;
    emitNativePathChange();
    return;
  }
  if (window.location.hash === nextPath) return;
  window.location.hash = nextPath;
}

export function replaceAppPath(path: string) {
  const nextPath = normalizeAppPath(path);
  if (typeof window === "undefined") {
    nativeAppPath = nextPath;
    return;
  }
  if (isNativeShell()) {
    if (nativeAppPath === nextPath) return;
    nativeAppPath = nextPath;
    emitNativePathChange();
    return;
  }
  const url = new URL(window.location.href);
  url.hash = nextPath;
  window.history.replaceState({}, "", url.toString());
}

export function subscribeAppPathChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (isNativeShell()) {
    window.addEventListener(APP_PATH_CHANGE_EVENT, listener as EventListener);
    return () => {
      window.removeEventListener(APP_PATH_CHANGE_EVENT, listener as EventListener);
    };
  }
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
  };
}

if (typeof window !== "undefined") {
  nativeAppPath = normalizeAppPath(window.location.hash);
}