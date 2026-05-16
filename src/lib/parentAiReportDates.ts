/** KST 기준 YYYY-MM-DD */
export function getKstYmd(d = new Date()): string {
  const t = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** KST 기준 어제 */
export function getKstYesterdayYmd(d = new Date()): string {
  const t = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  t.setUTCDate(t.getUTCDate() - 1);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatReportDateKey(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return getKstYmd(value);
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
