import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWeekStartKeySeoul } from "../../lib/weekDates";
import {
  buildA4PagesPdfBlob,
  captureA4PagesForPdf,
  downloadPdfBlob
} from "../../lib/exportElementToPdf";
import { ParentGrowthReportPremiumView } from "./growthReport/ParentGrowthReportPremiumView";
import { ParentGrowthReportPdfViewer } from "./growthReport/ParentGrowthReportPdfViewer";
import type { ParentStudentRow } from "../../types/parent";
import ko from "../fallbacks/ko.json";

const growthFb = ko.gptOutputFallbacks.parentGrowthReport;

type StressBand = "high" | "mid" | "low" | null;

export type ParentGrowthReportPayload = {
  weekStart: string;
  weekEnd: string;
  studentName: string;
  gradeLine: string | null;
  headerBadgeWeek: string;
  dateRangeLabel: string;
  badgePlanDeltaPct: number | null;
  badgeSleepRecovery: boolean;
  sleepGoalHours: number;
  meta?: {
    reportId: string;
    issuedAt: string;
    studentGoal: string | null;
    targetGrade: string | null;
    observedDaysCount: number;
    weeklyStudyGoalHours: number;
    coachName: string;
  };
  prevWeek?: {
    studyRoomHours: number;
    actualStudyHours: number;
    achievementPct: number | null;
    focusEfficiencyPct: number | null;
  };
  daily: Array<{
    dateKey: string;
    weekdayLabel: string;
    sleepHours: number | null;
    brainRecoveryIndex: number | null;
    stressScore: number | null;
    stressBand: StressBand;
    studyRoomMinutes: number;
    studyMinutesFromLog: number | null;
  }>;
  studyEfficiency: {
    studyRoomHours: number;
    actualStudyHours: number;
    focusBandHours: number;
    focusEfficiencyPct: number | null;
    vsPrevWeekEfficiencyDeltaPct: number | null;
  };
  planExecution: {
    achievementPct: number | null;
    completedCount: number;
    totalTracked: number;
    vsPrevWeekAchievementDeltaPct: number | null;
    bestCompleted: Array<{ title: string; completedDayLabel: string }>;
    carryOver: Array<{ title: string }>;
  };
  narrative: {
    weeklySummary: string;
    energyParentTip: string;
    studyEfficiencyInsight: string;
    planExecutionSummary: string;
    nextWeekForStudent: string;
    nextWeekForParent: string;
  };
  usedOpenAi: boolean;
};

const GROWTH_REPORT_CACHE_PREFIX = "parent-growth-report-v2";
const PDF_BUILD_CHART_WAIT_MS = 500;

function buildGrowthReportCacheKey(studentId: number, weekStart: string) {
  return `${GROWTH_REPORT_CACHE_PREFIX}:${studentId}:${weekStart}`;
}

function waitForCharts() {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, PDF_BUILD_CHART_WAIT_MS);
      });
    });
  });
}

export function ParentGrowthReportTab(props: {
  apiBase: string;
  authToken: string | null;
  selectedStudent: ParentStudentRow;
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [data, setData] = useState<ParentGrowthReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategyTab, setStrategyTab] = useState<"student" | "parent">("student");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfBuilding, setPdfBuilding] = useState(false);
  const [pdfBuildError, setPdfBuildError] = useState<string | null>(null);
  const pdfSourceRef = useRef<HTMLDivElement | null>(null);
  const buildGenRef = useRef(0);

  const weekStart = useMemo(
    () => getWeekStartKeySeoul(props.parentWeekOffset),
    [props.parentWeekOffset]
  );

  useEffect(() => {
    if (!props.authToken) {
      setData(null);
      return;
    }
    const cacheKey = buildGrowthReportCacheKey(props.selectedStudent.id, weekStart);
    let hasCached = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as ParentGrowthReportPayload;
        if (parsed && typeof parsed === "object" && typeof parsed.weekStart === "string") {
          setData(parsed);
          setError(null);
          setLoading(false);
          hasCached = true;
        }
      }
    } catch {
      // ignore cache parse errors
    }
    let cancelled = false;
    if (!hasCached) {
      setLoading(true);
    }
    setError(null);
    const ac = new AbortController();
    void fetch(
      `${props.apiBase}/api/parent/growth-report?studentId=${encodeURIComponent(String(props.selectedStudent.id))}&weekStart=${encodeURIComponent(weekStart)}`,
      {
        signal: ac.signal,
        cache: "no-store",
        headers: { Authorization: `Bearer ${props.authToken}` }
      }
    )
      .then(async res => {
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String((raw as { error?: string }).error || growthFb.loadFailed));
        }
        if (cancelled) return;
        const payload = raw as ParentGrowthReportPayload;
        setData(payload);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(payload));
        } catch {
          // ignore quota errors
        }
      })
      .catch((e: unknown) => {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : growthFb.loadFailed);
        if (!hasCached) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [props.apiBase, props.authToken, props.selectedStudent.id, weekStart]);

  const n = data?.narrative;

  const pdfFileNameBase = useMemo(
    () => (data ? `성장리포트_${data.studentName}_${weekStart}` : ""),
    [data, weekStart]
  );

  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  useEffect(() => {
    if (!data?.narrative) {
      setPdfBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfBlob(null);
      setPdfBuildError(null);
      setPdfBuilding(false);
      return;
    }

    const gen = ++buildGenRef.current;
    let cancelled = false;

    setPdfBuilding(true);
    setPdfBuildError(null);
    setPdfBlobUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPdfBlob(null);

    void (async () => {
      await waitForCharts();
      if (cancelled || buildGenRef.current !== gen) return;

      const root = pdfSourceRef.current;
      if (!root) {
        throw new Error(growthFb.pdfExportFailedGeneric);
      }

      const captures = await captureA4PagesForPdf(root, {
        ignoreClassName: "parent-growth-report__pdf-skip"
      });
      if (cancelled || buildGenRef.current !== gen) return;

      const blob = buildA4PagesPdfBlob(captures, { fillPage: true, marginMm: 0 });
      if (cancelled || buildGenRef.current !== gen) return;

      const url = URL.createObjectURL(blob);
      setPdfBlob(blob);
      setPdfBlobUrl(url);
    })()
      .catch((e: unknown) => {
        if (!cancelled && buildGenRef.current === gen) {
          setPdfBuildError(
            e instanceof Error ? e.message : growthFb.pdfExportFailedGeneric
          );
        }
      })
      .finally(() => {
        if (!cancelled && buildGenRef.current === gen) {
          setPdfBuilding(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data, weekStart, strategyTab]);

  const handleDownloadPdf = useCallback(() => {
    if (!pdfBlob || !pdfFileNameBase) return;
    downloadPdfBlob(pdfBlob, pdfFileNameBase);
  }, [pdfBlob, pdfFileNameBase]);

  return (
    <div className="parent-growth-report-shell">
      {loading && !data ? <p className="pgr-loading">불러오는 중…</p> : null}
      {error ? (
        <p className="pgr-error" role="alert">
          {error}
        </p>
      ) : null}

      {data && n ? (
        <>
          <ParentGrowthReportPdfViewer
            pdfUrl={pdfBlobUrl}
            building={pdfBuilding || loading}
            buildError={pdfBuildError}
            fileNameBase={pdfFileNameBase}
            parentWeekOffset={props.parentWeekOffset}
            setParentWeekOffset={props.setParentWeekOffset}
            strategyTab={strategyTab}
            setStrategyTab={setStrategyTab}
            onDownload={handleDownloadPdf}
            downloadDisabled={pdfBuilding || !pdfBlob}
          />
          <div ref={pdfSourceRef} className="parent-growth-report__pdf-source" aria-hidden="true">
            <ParentGrowthReportPremiumView data={data} strategyTab={strategyTab} pdfSource />
          </div>
        </>
      ) : !loading && !error ? (
        <p className="pgr-loading">표시할 데이터가 없습니다.</p>
      ) : null}
    </div>
  );
}
