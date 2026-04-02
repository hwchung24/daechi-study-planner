export const API_BASE = String(
  (import.meta as any).env?.VITE_API_BASE || "http://localhost:3000"
).replace(/\/+$/, "");
