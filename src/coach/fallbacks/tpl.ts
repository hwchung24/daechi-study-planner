/** `{{key}}` 치환 (숫자·문자 모두 허용) */
export function tpl(str: string, vars: Record<string, string | number>): string {
  return String(str || "").replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v != null && v !== "" ? String(v) : "";
  });
}
