import { getAppPath } from "./appNavigation";

type AppRoute = "student" | "parent" | "auth";

const DEVICE_SERIAL_STORAGE_KEY = "daechi_device_serial";
const TOKEN_STORAGE_KEY = "daechi_planner_token";

export function parseStudentTabFromHash(path = getAppPath()) {
  const h = path;
  if (h === "#/profile" || h === "#/settings") return "profile" as const;
  /** #/notifications 는 알림 모달만 열고 본문 탭은 오늘로 유지 */
  if (h === "#/notifications") return "today" as const;
  if (h === "#/records" || h === "#/week") return "records" as const;
  if (h === "#/store") return "store" as const;
  return "today" as const;
}

export function parseCoachStudentTabFromHash(path = getAppPath()) {
  const h = path;
  if (!h.startsWith("#/student/")) return null;
  const subPath = h.slice("#/student/".length).split("?")[0];
  const seg = (subPath || "home").replace(/^\/+/, "");
  if (seg === "coach" || seg === "chat") return "coach" as const;
  return "home" as const;
}

/** 코치 통합 탭(분석/계획/학습 코칭) — URL `?panel=plan` 등 */
export type CoachStudentPanelParam = "plan" | "analysis" | "chat" | "admin";

export function readCoachPanelParamFromHash(path = getAppPath()): CoachStudentPanelParam | null {
  const h = String(path || "");
  if (!h.startsWith("#/student/")) return null;
  const q = h.indexOf("?");
  if (q < 0) return null;
  const p = new URLSearchParams(h.slice(q + 1)).get("panel");
  if (p === "plan" || p === "analysis" || p === "chat" || p === "admin") return p;
  return null;
}

export function stripCoachPanelParamFromHash(hash: string): string {
  if (!hash.includes("?")) return hash;
  const q = hash.indexOf("?");
  const base = hash.slice(0, q);
  const params = new URLSearchParams(hash.slice(q + 1));
  if (!params.has("panel")) return hash;
  params.delete("panel");
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

export function parseCoachParentTabFromHash(path = getAppPath()) {
  const h = path;
  if (h === "#/parent" || h === "#/parent/profile") return null;
  if (h === "#/parent/report") return "aiReport" as const;
  if (!h.startsWith("#/parent/")) return null;
  const subPath = h.slice("#/parent/".length).split("?")[0];
  const seg = (subPath || "home").replace(/^\/+/, "");
  if (seg === "manage") return "manage" as const;
  if (seg === "ai-report") return "aiReport" as const;
  if (seg === "records") return "records" as const;
  if (seg === "student-settings") return "studentSettings" as const;
  return "manage" as const;
}

export function parseRouteFromHash(path = getAppPath()): AppRoute {
  const h = path;
  if (h.startsWith("#/parent")) return "parent";
  if (h === "#/auth") return "auth";
  return "student";
}

export function parseParentTabFromHash(path = getAppPath()) {
  if (path === "#/parent/profile") return "profile" as const;
  return "profile" as const;
}

export function getInitialRoute(): AppRoute {
  if (typeof window === "undefined") return "auth";
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return "auth";
  }
  if (!token) return "auth";
  const h = getAppPath();
  if (h.startsWith("#/parent")) return "parent";
  if (h === "#/auth") return "student";
  return parseRouteFromHash(h);
}

export function getSerialFromLocation(): string {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.href);
    const searchSerial = String(url.searchParams.get("serial") || "").trim();
    if (searchSerial) return searchSerial;
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      return String(hashParams.get("serial") || "").trim();
    }
    return "";
  } catch {
    return "";
  }
}

export function injectSerialIntoLocation(serial: string) {
  if (typeof window === "undefined") return;
  const safe = String(serial || "").trim();
  if (!safe) return;
  try {
    const url = new URL(window.location.href);
    if (String(url.searchParams.get("serial") || "").trim()) return;
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hashPath = hash.slice(0, qIdx);
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      if (String(hashParams.get("serial") || "").trim()) return;
      hashParams.set("serial", safe);
      url.hash = `${hashPath}?${hashParams.toString()}`;
    } else if (hash) {
      url.hash = `${hash}?serial=${encodeURIComponent(safe)}`;
    } else {
      url.hash = `#/?serial=${encodeURIComponent(safe)}`;
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore
  }
}

export function scrubSerialFromLocation() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has("serial")) {
      url.searchParams.delete("serial");
      changed = true;
    }
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hashPath = hash.slice(0, qIdx);
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
      if (hashParams.has("serial")) {
        hashParams.delete("serial");
        url.hash = hashParams.toString()
          ? `${hashPath}?${hashParams.toString()}`
          : hashPath;
        changed = true;
      }
    }
    if (!changed) return;
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore
  }
}

function getStoredSerial(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(DEVICE_SERIAL_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function resolvePreferredSerial(): string {
  return getSerialFromLocation() || getStoredSerial();
}

export function persistSerial(serial: string) {
  if (typeof window === "undefined") return;
  const safe = String(serial || "").trim();
  if (!safe) return;
  try {
    localStorage.setItem(DEVICE_SERIAL_STORAGE_KEY, safe);
  } catch {
    // ignore
  }
}
