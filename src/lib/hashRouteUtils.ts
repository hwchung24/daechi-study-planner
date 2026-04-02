type AppRoute = "student" | "parent" | "auth";

const DEVICE_SERIAL_STORAGE_KEY = "daechi_device_serial";
const TOKEN_STORAGE_KEY = "daechi_planner_token";

export function parseStudentTabFromHash() {
  if (typeof window === "undefined") return "today" as const;
  const h = window.location.hash;
  if (h === "#/settings") return "settings" as const;
  if (h === "#/week") return "week" as const;
  if (h === "#/store") return "store" as const;
  return "today" as const;
}

export function parseCoachStudentTabFromHash() {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  if (!h.startsWith("#/student/")) return null;
  const path = h.slice("#/student/".length).split("?")[0];
  const seg = (path || "home").replace(/^\/+/, "");
  if (seg === "coach" || seg === "chat") return "coach" as const;
  return "home" as const;
}

export function parseCoachParentTabFromHash() {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  if (h === "#/parent" || h === "#/parent/report") return null;
  if (!h.startsWith("#/parent/")) return null;
  const path = h.slice("#/parent/".length).split("?")[0];
  const seg = (path || "home").replace(/^\/+/, "");
  if (seg === "timeline") return "timeline" as const;
  if (seg === "guide") return "guide" as const;
  if (seg === "profile") return "profile" as const;
  return "home" as const;
}

export function parseRouteFromHash(): AppRoute {
  if (typeof window === "undefined") return "student";
  const h = window.location.hash;
  if (h.startsWith("#/parent")) return "parent";
  if (h === "#/auth") return "auth";
  return "student";
}

export function parseParentTabFromHash() {
  if (typeof window === "undefined") return "link" as const;
  return window.location.hash === "#/parent/report"
    ? ("report" as const)
    : ("link" as const);
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
  const h = window.location.hash;
  if (h.startsWith("#/parent")) return "parent";
  if (h === "#/auth") return "student";
  return parseRouteFromHash();
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
