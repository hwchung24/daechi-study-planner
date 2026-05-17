import React from "react";
import { createPortal } from "react-dom";
import { FileDown, X } from "lucide-react";
import type { ElementPdfCapture } from "../../lib/exportElementToPdf";

export function ParentGrowthReportPdfPreviewModal(props: {
  open: boolean;
  revealed: boolean;
  loading: boolean;
  capture: ElementPdfCapture | null;
  captures?: ElementPdfCapture[];
  error: string | null;
  fileLabel: string;
  exporting: boolean;
  title: string;
  hint: string;
  loadingLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  exportingLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) return null;

  const pages =
    props.captures && props.captures.length > 0
      ? props.captures
      : props.capture
        ? [props.capture]
        : [];

  return createPortal(
    <div
      className={"dday-modal parent-growth-report-pdf-preview" + (props.revealed ? " dday-modal--open" : "")}
      role="presentation"
      onClick={props.onClose}
    >
      <div
        className="dday-modal-inner parent-growth-report-pdf-preview__inner"
        role="dialog"
        aria-modal="true"
        aria-labelledby="parent-growth-report-pdf-preview-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="dday-modal-header parent-growth-report-pdf-preview__header">
          <div>
            <h2 id="parent-growth-report-pdf-preview-title" className="dday-modal-title">
              {props.title}
            </h2>
            <p className="parent-growth-report-pdf-preview__hint">{props.hint}</p>
            <p className="parent-growth-report-pdf-preview__file parent-type-caption">{props.fileLabel}</p>
          </div>
          <button
            type="button"
            className="parent-growth-report-pdf-preview__close coach-icon-btn"
            aria-label={props.cancelLabel}
            onClick={props.onClose}
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="dday-modal-body parent-growth-report-pdf-preview__body">
          {props.loading ? (
            <p className="parent-growth-report-pdf-preview__status coach-muted">{props.loadingLabel}</p>
          ) : props.error ? (
            <p className="parent-growth-report-pdf-preview__status" role="alert">
              {props.error}
            </p>
          ) : pages.length > 0 ? (
            <div className="parent-growth-report-pdf-preview__pages">
              {pages.map((page, index) => (
                <div key={index} className="parent-growth-report-pdf-preview__page-wrap">
                  <div
                    className="parent-growth-report-pdf-preview__page"
                    aria-label={`${props.title} ${index + 1}페이지`}
                  >
                    <img
                      src={page.imgData}
                      alt=""
                      className="parent-growth-report-pdf-preview__img"
                      width={page.width}
                      height={page.height}
                    />
                  </div>
                  {pages.length > 1 ? (
                    <p className="parent-growth-report-pdf-preview__page-label">
                      {index + 1} / {pages.length}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="dday-modal-footer parent-growth-report-pdf-preview__footer">
          <button type="button" className="modal-secondary" onClick={props.onClose}>
            {props.cancelLabel}
          </button>
          <button
            type="button"
            className="coach-primary-btn parent-growth-report-pdf-preview__save"
            disabled={props.loading || !!props.error || pages.length === 0 || props.exporting}
            onClick={props.onConfirm}
          >
            <FileDown size={18} aria-hidden />
            {props.exporting ? props.exportingLabel : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
