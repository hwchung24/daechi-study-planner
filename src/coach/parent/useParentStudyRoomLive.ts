import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scheduleBackgroundUiUpdate } from "../../lib/stableUiUpdate";
import { stableStringify } from "../../lib/stableUiUpdate";
import { seoulDateKeyFromApiValue } from "../../lib/weekDates";
import type { StudyRoomVisitSession } from "../../types/studyRoomTracking";

const POLL_ACTIVE_MS = 30000;
const POLL_IDLE_MS = 90000;

export type ParentStudyRoomLiveStatus = {
  currentDistanceMeters: number | null;
  currentWithinRadius: boolean | null;
  currentHeartbeatAt: string | null;
  currentAccuracyMeters: number | null;
  currentRadiusMeters: number | null;
  studyRoomName: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  studyRoomAddress: string | null;
  studyRoomLatitude: number | null;
  studyRoomLongitude: number | null;
};

type UseArgs = {
  apiBase: string;
  authToken: string | null;
  studentId: number | null;
  /** `studyRoom` from student row — used only to decide poll interval before first response */
  hasStudyRoomSettingHint?: boolean;
};

const emptyLive = (): ParentStudyRoomLiveStatus => ({
  currentDistanceMeters: null,
  currentWithinRadius: null,
  currentHeartbeatAt: null,
  currentAccuracyMeters: null,
  currentRadiusMeters: null,
  studyRoomName: null,
  currentLatitude: null,
  currentLongitude: null,
  studyRoomAddress: null,
  studyRoomLatitude: null,
  studyRoomLongitude: null
});

export function useParentStudyRoomLive(args: UseArgs) {
  const { apiBase, authToken, studentId, hasStudyRoomSettingHint } = args;
  const [studyRoomVisits, setStudyRoomVisits] = useState<StudyRoomVisitSession[]>([]);
  const [studyRoomVisitsLoading, setStudyRoomVisitsLoading] = useState(false);
  const [studyRoomLiveStatus, setStudyRoomLiveStatus] =
    useState<ParentStudyRoomLiveStatus>(emptyLive);
  const studyRoomVisitsHasDataRef = useRef(studyRoomVisits.length > 0);
  const studyRoomPollSigRef = useRef<string | null>(null);

  useEffect(() => {
    studyRoomVisitsHasDataRef.current = studyRoomVisits.length > 0;
  }, [studyRoomVisits]);

  const hasStudyRoomConfig = Boolean(
    (studyRoomLiveStatus.studyRoomName && String(studyRoomLiveStatus.studyRoomName).trim()) ||
      hasStudyRoomSettingHint
  );

  const latestVisitDistance =
    studyRoomVisits.find(visit => visit.lastDistanceMeters != null)?.lastDistanceMeters ?? null;
  const displayDistanceMeters =
    studyRoomLiveStatus.currentDistanceMeters != null
      ? studyRoomLiveStatus.currentDistanceMeters
      : latestVisitDistance;

  const studyRoomVisitsByDate = useMemo(() => {
    const grouped = new Map<string, StudyRoomVisitSession[]>();
    for (const visit of studyRoomVisits) {
      const keySource = visit.enteredAt || visit.lastSeenAt || visit.exitedAt || "";
      const key = seoulDateKeyFromApiValue(keySource);
      if (!key) continue;
      const list = grouped.get(key) || [];
      list.push(visit);
      grouped.set(key, list);
    }
    return grouped;
  }, [studyRoomVisits]);

  const refreshStudyRoomVisits = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!authToken || !studentId) {
        studyRoomPollSigRef.current = null;
        setStudyRoomVisits([]);
        setStudyRoomVisitsLoading(false);
        setStudyRoomLiveStatus(emptyLive());
        return;
      }

      if (!options?.silent && !studyRoomVisitsHasDataRef.current) {
        setStudyRoomVisitsLoading(true);
      }

      try {
        const res = await fetch(
          `${apiBase}/api/parent/students/${encodeURIComponent(String(studentId))}/study-room-visits?limit=6`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${authToken}`
            }
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          visits?: StudyRoomVisitSession[];
          currentDistanceMeters?: number | null;
          currentWithinRadius?: boolean | null;
          currentHeartbeatAt?: string | null;
          currentAccuracyMeters?: number | null;
          currentRadiusMeters?: number | null;
          studyRoomName?: string | null;
          currentLatitude?: number | null;
          currentLongitude?: number | null;
          studyRoomAddress?: string | null;
          studyRoomLatitude?: number | null;
          studyRoomLongitude?: number | null;
        };
        const nextVisits = Array.isArray(data.visits) ? data.visits : [];
        const nextLive: ParentStudyRoomLiveStatus = {
          currentDistanceMeters:
            data.currentDistanceMeters != null && Number.isFinite(Number(data.currentDistanceMeters))
              ? Number(data.currentDistanceMeters)
              : null,
          currentWithinRadius:
            typeof data.currentWithinRadius === "boolean" ? data.currentWithinRadius : null,
          currentHeartbeatAt:
            data.currentHeartbeatAt != null ? String(data.currentHeartbeatAt) : null,
          currentAccuracyMeters:
            data.currentAccuracyMeters != null && Number.isFinite(Number(data.currentAccuracyMeters))
              ? Number(data.currentAccuracyMeters)
              : null,
          currentRadiusMeters:
            data.currentRadiusMeters != null && Number.isFinite(Number(data.currentRadiusMeters))
              ? Number(data.currentRadiusMeters)
              : null,
          studyRoomName: data.studyRoomName != null ? String(data.studyRoomName) : null,
          currentLatitude:
            data.currentLatitude != null && Number.isFinite(Number(data.currentLatitude))
              ? Number(data.currentLatitude)
              : null,
          currentLongitude:
            data.currentLongitude != null && Number.isFinite(Number(data.currentLongitude))
              ? Number(data.currentLongitude)
              : null,
          studyRoomAddress:
            data.studyRoomAddress != null && String(data.studyRoomAddress).trim() !== ""
              ? String(data.studyRoomAddress).trim()
              : null,
          studyRoomLatitude:
            data.studyRoomLatitude != null && Number.isFinite(Number(data.studyRoomLatitude))
              ? Number(data.studyRoomLatitude)
              : null,
          studyRoomLongitude:
            data.studyRoomLongitude != null && Number.isFinite(Number(data.studyRoomLongitude))
              ? Number(data.studyRoomLongitude)
              : null
        };
        const bundleSig = stableStringify({ visits: nextVisits, live: nextLive });
        if (studyRoomPollSigRef.current === bundleSig) {
          return;
        }
        studyRoomPollSigRef.current = bundleSig;
        scheduleBackgroundUiUpdate(() => {
          setStudyRoomVisits(nextVisits);
          setStudyRoomLiveStatus(nextLive);
        });
      } catch {
        studyRoomPollSigRef.current = null;
        setStudyRoomVisits([]);
        setStudyRoomLiveStatus(emptyLive());
      } finally {
        if (!options?.silent) {
          setStudyRoomVisitsLoading(false);
        }
      }
    },
    [apiBase, authToken, studentId]
  );

  useEffect(() => {
    void refreshStudyRoomVisits();
  }, [refreshStudyRoomVisits]);

  const hasConfigForPoll = Boolean(
    (studyRoomLiveStatus.studyRoomName && String(studyRoomLiveStatus.studyRoomName).trim()) ||
      hasStudyRoomSettingHint
  );

  useEffect(() => {
    if (!authToken || !studentId) {
      return;
    }
    const pollIntervalMs = hasConfigForPoll ? POLL_ACTIVE_MS : POLL_IDLE_MS;

    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void refreshStudyRoomVisits({ silent: true });
    };

    const timerId = window.setInterval(run, pollIntervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasConfigForPoll, authToken, studentId, refreshStudyRoomVisits]);

  return {
    studyRoomVisits,
    studyRoomVisitsLoading,
    studyRoomLiveStatus,
    hasStudyRoomConfig,
    displayDistanceMeters,
    studyRoomVisitsByDate,
    refreshStudyRoomVisits
  };
}
