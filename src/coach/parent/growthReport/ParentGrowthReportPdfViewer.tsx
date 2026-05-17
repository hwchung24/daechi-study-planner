import React from "react";
import { ChevronLeft, ChevronRight, FileDown, Home, User } from "lucide-react";

export function ParentGrowthReportPdfViewer(props: {
  pdfUrl: string | null;
  building: boolean;
  buildError: string | null;
  fileNameBase: string;
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  strategyTab: "student" | "parent";
  setStrategyTab: React.Dispatch<React.SetStateAction<"student" | "parent">>;
  onDownload: () => void;
  downloadDisabled: boolean;
}) {
  return (
    <div className="parent-growth-report-viewer">
      <div className="pgr-toolbar parent-growth-report__pdf-skip">
        <button
          type="button"
          className="pgr-toolbar__pdf coach-ghost-btn"
          disabled={props.downloadDisabled}
          onClick={props.onDownload}
        >
          <FileDown size={18} aria-hidden />
          PDF 저장
        </button>
        <div className="pgr-toolbar__strategy" role="tablist" aria-label="전략 대상">
          <button
            type="button"
            role="tab"
            aria-selected={props.strategyTab === "student"}
            className={
              "pgr-toolbar__strategy-btn" +
              (props.strategyTab === "student" ? " pgr-toolbar__strategy-btn--active" : "")
            }
            onClick={() => props.setStrategyTab("student")}
            disabled={props.building}
          >
            <User size={15} aria-hidden />
            학생
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.strategyTab === "parent"}
            className={
              "pgr-toolbar__strategy-btn" +
              (props.strategyTab === "parent" ? " pgr-toolbar__strategy-btn--active" : "")
            }
            onClick={() => props.setStrategyTab("parent")}
            disabled={props.building}
          >
            <Home size={15} aria-hidden />
            학부모
          </button>
        </div>
        <div className="pgr-toolbar__week-nav">
          <button
            type="button"
            className="pgr-toolbar__week-btn coach-ghost-btn"
            aria-label="이전 주"
            disabled={props.building}
            onClick={() => props.setParentWeekOffset(o => o + 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="pgr-toolbar__week-btn coach-ghost-btn"
            aria-label="다음 주"
            disabled={props.parentWeekOffset <= 0 || props.building}
            onClick={() => props.setParentWeekOffset(o => (o > 0 ? o - 1 : 0))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="parent-growth-report-viewer__frame">
        {props.building ? (
          <p className="parent-growth-report-viewer__status">PDF 문서 준비 중…</p>
        ) : props.buildError ? (
          <p
            className="parent-growth-report-viewer__status parent-growth-report-viewer__status--error"
            role="alert"
          >
            {props.buildError}
          </p>
        ) : props.pdfUrl ? (
          <iframe
            className="parent-growth-report-viewer__iframe"
            src={`${props.pdfUrl}#toolbar=1&navpanes=0&view=FitH`}
            title={props.fileNameBase ? `${props.fileNameBase}.pdf` : "주간 성장 리포트"}
          />
        ) : (
          <p className="parent-growth-report-viewer__status">표시할 리포트가 없습니다.</p>
        )}
      </div>
    </div>
  );
}