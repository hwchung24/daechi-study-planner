import { useCallback, useEffect, useRef, useState } from "react";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import { scheduleBackgroundUiUpdate } from "../../lib/stableUiUpdate";
import { stableStringify } from "../../lib/stableUiUpdate";
import {
  type ParentMdmSurfaceMode,
  parseParentMdmSurfaceMode
} from "./parentDeviceModeDisplay";

const POLL_MS = 30000;

type AppAllowanceModeKey = "utility" | "free";

export type ParentSimpleMdmNetworkStatus = {
  available: boolean;
  status: "recent" | "stale" | "unknown" | "skipped";
  skippedReason?: string;
  lastSeenAt?: string | null;
  ageMinutes?: number | null;
  /** 서버 기준 마지막 MDM 통신 이후 경과 초(표시·짧은 구간용) */
  lastSeenAgeSeconds?: number | null;
  carrierNetwork?: string | null;
};

export type ParentDeviceControlSnapshot = {
  displaySurfaceMode: ParentMdmSurfaceMode;
  kioskEnabled: boolean;
  activeAppAllowanceMode: AppAllowanceModeKey | null;
  /** 서버에 저장된 분 단위 자유시간 만료(ISO 문자열). 없으면 수동 종료 전까지·또는 미설정 */
  parentTimedFreeExpiresAt: string | null;
  simpleMdmNetwork: ParentSimpleMdmNetworkStatus | null;
};

function normalizeSimpleMdmNetwork(
  raw: unknown
): ParentSimpleMdmNetworkStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const status = String(o.status || "").trim();
  if (
    status !== "recent" &&
    status !== "stale" &&
    status !== "unknown" &&
    status !== "skipped"
  ) {
    return null;
  }
  return {
    available: Boolean(o.available),
    status: status as ParentSimpleMdmNetworkStatus["status"],
    skippedReason:
      o.skippedReason != null ? String(o.skippedReason).trim() || undefined : undefined,
    lastSeenAt:
      o.lastSeenAt != null && String(o.lastSeenAt).trim()
        ? String(o.lastSeenAt).trim()
        : null,
    ageMinutes:
      o.ageMinutes != null && Number.isFinite(Number(o.ageMinutes))
        ? Number(o.ageMinutes)
        : null,
    lastSeenAgeSeconds:
      o.lastSeenAgeSeconds != null && Number.isFinite(Number(o.lastSeenAgeSeconds))
        ? Number(o.lastSeenAgeSeconds)
        : null,
    carrierNetwork:
      o.carrierNetwork != null && String(o.carrierNetwork).trim()
        ? String(o.carrierNetwork).trim()
        : null
  };
}

function computeSnapshot(data: {
  mdmSurfaceMode?: string;
  kioskEnabled?: boolean;
  bulkLockOverride?: boolean;
  appAllowanceMode?: "default" | AppAllowanceModeKey;
  parentTimedFreeExpiresAt?: string | null;
  simpleMdmNetwork?: unknown;
}): ParentDeviceControlSnapshot {
  const parsedSurface = parseParentMdmSurfaceMode(data.mdmSurfaceMode);
  const effectiveSurface: ParentMdmSurfaceMode = parsedSurface ?? "default";
  const bulkLock =
    effectiveSurface === "block" || Boolean(data.bulkLockOverride);
  const displaySurfaceMode: ParentMdmSurfaceMode = bulkLock ? "block" : effectiveSurface;
  const activeAppAllowanceMode =
    data.appAllowanceMode === "utility" || data.appAllowanceMode === "free"
      ? data.appAllowanceMode
      : null;
  const rawUntil = data.parentTimedFreeExpiresAt;
  const parentTimedFreeExpiresAt =
    rawUntil != null && String(rawUntil).trim() ? String(rawUntil).trim() : null;
  return {
    displaySurfaceMode,
    kioskEnabled: Boolean(data.kioskEnabled),
    activeAppAllowanceMode,
    parentTimedFreeExpiresAt,
    simpleMdmNetwork: normalizeSimpleMdmNetwork(data.simpleMdmNetwork)
  };
}

type UseArgs = {
  apiBase: string;
  authToken: string | null;
  studentId: number | null;
};

export function useParentDeviceControlState(args: UseArgs) {
  const { apiBase, authToken, studentId } = args;
  const bearer = useEffectiveBearer(authToken);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<ParentDeviceControlSnapshot | null>(null);
  const lastSigRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!bearer || !studentId) {
        lastSigRef.current = null;
        scheduleBackgroundUiUpdate(() => {
          setSnapshot(null);
          setLoading(false);
        });
        return;
      }
      if (!options?.silent) {
        setLoading(true);
      }
      try {
        const res = await fetch(
          `${apiBase}/api/parent/students/${encodeURIComponent(String(studentId))}/device-control-state`,
          { headers: { Authorization: `Bearer ${bearer}` } }
        );
        const data = (await res.json().catch(() => ({}))) as {
          appAllowanceMode?: "default" | AppAllowanceModeKey;
          mdmSurfaceMode?: string;
          kioskEnabled?: boolean;
          bulkLockOverride?: boolean;
          parentTimedFreeExpiresAt?: string | null;
          simpleMdmNetwork?: unknown;
        };
        if (!res.ok) {
          const fallback = computeSnapshot({});
          const sig = stableStringify({ ok: false, ...fallback });
          if (lastSigRef.current !== sig) {
            lastSigRef.current = sig;
            scheduleBackgroundUiUpdate(() => setSnapshot(fallback));
          }
          return;
        }
        const next = computeSnapshot(data);
        const sig = stableStringify({ ok: true, ...next });
        if (lastSigRef.current === sig) {
          return;
        }
        lastSigRef.current = sig;
        scheduleBackgroundUiUpdate(() => setSnapshot(next));
      } catch {
        lastSigRef.current = null;
        scheduleBackgroundUiUpdate(() => setSnapshot(null));
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [apiBase, bearer, studentId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!bearer || !studentId) return;

    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refresh({ silent: true });
    };

    const timerId = window.setInterval(run, POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      run();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [bearer, studentId, refresh]);

  return { loading, snapshot, refresh };
}
