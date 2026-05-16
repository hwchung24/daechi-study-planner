/** 학부모 UI용 짧은 문장 추출 */
export function firstSentence(text: string, maxLen = 96): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const parts = raw.split(/(?<=[.!?。])\s+/);
  const first = (parts[0] || raw).trim();
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen - 1).trim()}…`;
}

export function hasMoreThanHeadline(full: string, headline: string): boolean {
  const a = String(full || "").trim();
  const b = String(headline || "").trim();
  return a.length > b.length + 8;
}

/** AI 본문에 섞인 날짜·주차 구간 표기 제거 */
export function stripEmbeddedDateRanges(text: string): string {
  return String(text || "")
    .replace(/이번\s*주\s*\([^)]*\)/gi, "")
    .replace(/이번\s*주\s*[·•]\s*/gi, "")
    .replace(/\(\d{4}-\d{2}-\d{2}\s*[~\-–]\s*\d{4}-\d{2}-\d{2}\)/g, "")
    .replace(/\(\d{4}-\d{2}-\d{2}\s*[~\-–]\s*\d{2}-\d{2}\)/g, "")
    .replace(/\d{4}-\d{2}-\d{2}\s*[~\-–]\s*\d{2}-\d{2}/g, "")
    .replace(/\d{1,2}\/\d{1,2}\s*[~\-–]\s*\d{1,2}\/\d{1,2}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.。])/g, "$1")
    .trim();
}

/** 인사 제목 다음 본문(중복 인사 제외) */
export function bodyAfterHeadline(full: string, headline: string): string {
  const a = String(full || "").trim();
  const b = String(headline || "").trim();
  if (!a) return "";
  if (!b || a === b) return "";
  if (a.startsWith(b)) {
    return a
      .slice(b.length)
      .trim()
      .replace(/^[,.，、。\s]+/, "");
  }
  return a;
}
