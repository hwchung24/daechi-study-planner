/**
 * 미설정 시 로컬 백엔드로 직접 붙습니다(5173→프록시에 의존하지 않음).
 * LAN/배포 주소가 필요하면 루트에 `.env`로 `VITE_API_BASE=https://...` 설정.
 */
export const API_BASE = String(
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:3000"
).replace(/\/+$/, "");
