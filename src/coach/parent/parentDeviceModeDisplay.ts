export type ParentMdmSurfaceMode =
  | "block"
  | "schedule"
  | "utility"
  | "free"
  | "default";

export const PARENT_MDM_SURFACE_LABEL: Record<ParentMdmSurfaceMode, string> = {
  block: "일괄잠금",
  schedule: "계획표",
  utility: "유틸리티",
  free: "자유시간",
  default: "기본"
};

export function parseParentMdmSurfaceMode(raw: unknown): ParentMdmSurfaceMode | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "bulk_lock") return "block";
  if (
    s === "block" ||
    s === "schedule" ||
    s === "utility" ||
    s === "free" ||
    s === "default"
  ) {
    return s as ParentMdmSurfaceMode;
  }
  return null;
}
