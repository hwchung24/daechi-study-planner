const API_BASE_OVERRIDE_STORAGE_KEY = "daechi_api_base_override";

function normalizeApiBase(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getStoredApiBaseOverride(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeApiBase(localStorage.getItem(API_BASE_OVERRIDE_STORAGE_KEY));
  } catch {
    return "";
  }
}

function getBrowserOriginApiBase(): string {
  if (typeof window === "undefined") return "";
  const protocol = String(window.location.protocol || "").toLowerCase();
  if (protocol === "http:" || protocol === "https:") {
    return normalizeApiBase(window.location.origin);
  }
  return "";
}

export function persistApiBaseOverride(value: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizeApiBase(value);
  if (!normalized) return;
  try {
    localStorage.setItem(API_BASE_OVERRIDE_STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
}

/**
 * 우선순위
 * 1) Native + Managed App Config/localStorage로 저장된 api_base
 * 2) 빌드 시점 VITE_API_BASE
 * 3) 브라우저 same-origin (웹 배포)
 * 4) 로컬 개발 기본값
 */
export const API_BASE =
  getStoredApiBaseOverride() ||
  normalizeApiBase((import.meta as any).env?.VITE_API_BASE) ||
  getBrowserOriginApiBase() ||
  "http://localhost:3000";
