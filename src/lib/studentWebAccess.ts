import { Capacitor } from "@capacitor/core";

/**
 * 학생 UI를 웹 브라우저에서 막을지 여부.
 * - 네이티브(Capacitor) 앱: 항상 허용
 * - `VITE_ALLOW_STUDENT_WEB=true`: 웹에서도 허용(스테이징·디버그)
 * - 그 외 production 빌드의 웹: 차단
 * - `import.meta.env.DEV`(vite dev 서버): 허용 — 로컬에서 학생 화면 테스트 가능
 */
export function isStudentWebShellBlocked(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (import.meta.env.VITE_ALLOW_STUDENT_WEB === "true") return false;
  if (import.meta.env.DEV) return false;
  return import.meta.env.PROD;
}
