import { Capacitor } from "@capacitor/core";
import { API_BASE } from "./apiBase";

const HEADER = "X-Daechi-Client";
const VALUE = "native";

/**
 * Capacitor 앱에서 API_BASE 로 가는 요청에 서버가 검사하는 클라이언트 헤더를 붙입니다.
 * (운영 웹에서 학생 API 차단과 짝을 맞춤)
 */
export function installNativeClientFetchHeader(): void {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) {
    return;
  }
  const base = API_BASE.replace(/\/+$/, "");
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      const resolved = /^https?:\/\//i.test(url)
        ? url
        : new URL(url, window.location.origin).href;
      if (resolved.startsWith(base)) {
        const next: RequestInit = { ...init };
        const h = new Headers(
          init?.headers != null
            ? init.headers
            : input instanceof Request
              ? input.headers
              : undefined
        );
        if (!h.has(HEADER)) {
          h.set(HEADER, VALUE);
        }
        next.headers = h;
        if (input instanceof Request) {
          return orig(new Request(input, next));
        }
        return orig(url, next);
      }
    } catch {
      // fall through
    }
    return orig(input as RequestInfo, init);
  };
}
