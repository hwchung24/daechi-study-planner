import { startTransition } from "react";

/**
 * Deterministic JSON serialization for comparing API payloads / derived state.
 * Skips redundant React updates when polling returns identical data.
 */
export function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value));
  } catch {
    return `\0unstable:${String(value)}`;
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (t === "boolean" || t === "string") return value;
  if (t !== "object") return String(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = canonicalize(o[k]);
  }
  return out;
}

export function scheduleBackgroundUiUpdate(fn: () => void): void {
  startTransition(fn);
}
