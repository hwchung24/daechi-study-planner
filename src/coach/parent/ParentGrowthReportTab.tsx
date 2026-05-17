import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWeekStartKeySeoul } from "../../lib/weekDates";
import {
  captureElementForPdf,
  saveElementPdfCapture,
  type ElementPdfCapture
} from "../../lib/exportElementToPdf";
import { useModalReveal } from "../../lib/useModalReveal";
import { ParentGrowthReportPremiumView } from "./growthReport/ParentGrowthReportPremiumView";
import { ParentGrowthReportPdfPreviewModal } from "./ParentGrowthReportPdfPreviewModal";
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

function buildGrowthReportCacheKey(studentId: number, weekStart: string) {
  return `${GROWTH_REPORT_CACHE_PREFIX}:${studentId}:${weekStart}`;
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
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewCapture, setPdfPreviewCapture] = useState<ElementPdfCapture | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);
  const pdfPreviewReveal = useModalReveal(pdfPreviewOpen);

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

  const closePdfPreview = useCallback(() => {
    pdfPreviewReveal.beginClose(() => {
      setPdfPreviewOpen(false);
      setPdfPreviewCapture(null);
      setPdfPreviewError(null);
      setPdfPreviewLoading(false);
    });
  }, [pdfPreviewReveal]);

  const openPdfPreview = useCallback(() => {
    if (!data?.narrative) return;
    setPdfPreviewOpen(true);
  }, [data?.narrative]);

  useEffect(() => {
    if (!pdfPreviewOpen || !data?.narrative) return;
    const root = pdfCaptureRef.current;
    if (!root) return;

    let cancelled = false;
    setPdfPreviewLoading(true);
    setPdfPreviewError(null);
    setPdfPreviewCapture(null);

    void captureElementForPdf(root, {
      ignoreClassName: "parent-growth-report__pdf-skip"
    })
      .then(capture => {
        if (!cancelled) setPdfPreviewCapture(capture);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPdfPreviewError(
            e instanceof Error ? e.message : growthFb.pdfExportFailedGeneric
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPdfPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfPreviewOpen, data?.narrative, weekStart]);

  const handleConfirmSavePdf = useCallback(() => {
    if (!pdfPreviewCapture || !pdfFileNameBase) return;
    setPdfExporting(true);
    try {
      saveElementPdfCapture(pdfPreviewCapture, pdfFileNameBase, {
        fitSinglePage: true,
        marginMm: 6
      });
      closePdfPreview();
    } catch (e) {
      alert(
        e instanceof Error ? e.message : growthFb.pdfExportFailedGeneric
      );
    } finally {
      setPdfExporting(false);
    }
  }, [closePdfPreview, pdfFileNameBase, pdfPreviewCapture]);

  return (
    <div className="parent-growth-report-shell">
      <div ref={pdfCaptureRef} className="parent-growth-report__pdf-root">
        {data && n ? (
          <ParentGrowthReportPremiumView
            data={data}
            loading={loading}
            error={error}
            parentWeekOffset={props.parentWeekOffset}
            setParentWeekOffset={props.setParentWeekOffset}
            onPdfPreview={openPdfPreview}
            pdfPreviewDisabled={loading || pdfPreviewOpen}
          />
        ) : (
          <>
            {loading ? <p className="pgr-loading">불러오는 중…</p> : null}
            {error ? (
              <p className="pgr-error" role="alert">
                {error}
              </p>
            ) : null}
            {!loading && !error ? (
              <p className="pgr-loading">표시할 데이터가 없습니다.</p>
            ) : null}
          </>
        )}
      </div>

      <ParentGrowthReportPdfPreviewModal
        open={pdfPreviewOpen}
        revealed={pdfPreviewReveal.revealed}
        loading={pdfPreviewLoading}
        capture={pdfPreviewCapture}
        error={pdfPreviewError}
        fileLabel={pdfFileNameBase ? `${pdfFileNameBase}.pdf` : ""}
        exporting={pdfExporting}
        title={growthFb.pdfPreviewTitle || "PDF 미리보기"}
        hint={growthFb.pdfPreviewHint || "저장 전에 아래 내용을 확인해 주세요."}
        loadingLabel={growthFb.pdfPreviewLoading || "미리보기 준비 중…"}
        cancelLabel={growthFb.pdfPreviewCancel || "취소"}
        confirmLabel={growthFb.pdfPreviewConfirm || "PDF 저장"}
        exportingLabel={growthFb.pdfPreviewExporting || "PDF 만드는 중…"}
        onClose={closePdfPreview}
        onConfirm={handleConfirmSavePdf}
      />
    </div>
  );
}
