import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function sanitizeFileNameBase(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

export type ElementPdfCaptureOptions = {
  /** 캡처에서 제외할 요소에 붙인 클래스명 */
  ignoreClassName?: string;
};

export type ElementPdfSaveOptions = ElementPdfCaptureOptions & {
  /** true면 A4 1페이지 안에 축소해서 배치 */
  fitSinglePage?: boolean;
  /** 페이지 여백(mm), 기본 8 */
  marginMm?: number;
};

export type ElementPdfCapture = {
  imgData: string;
  width: number;
  height: number;
};

async function captureElementCanvas(
  element: HTMLElement,
  options?: ElementPdfCaptureOptions
): Promise<HTMLCanvasElement> {
  const ignoreClass = options?.ignoreClassName || "pdf-export-skip";
  return html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: document.documentElement.scrollWidth,
    windowHeight: document.documentElement.scrollHeight,
    ignoreElements: el => el.classList.contains(ignoreClass)
  });
}

/** DOM 노드를 캡처해 JPEG data URL과 크기를 반환합니다. */
export async function captureElementForPdf(
  element: HTMLElement,
  options?: ElementPdfCaptureOptions
): Promise<ElementPdfCapture> {
  const canvas = await captureElementCanvas(element, options);
  return {
    imgData: canvas.toDataURL("image/jpeg", 0.92),
    width: canvas.width,
    height: canvas.height
  };
}

/** 캡처 이미지를 A4 세로 PDF로 저장합니다. */
export function saveElementPdfCapture(
  capture: ElementPdfCapture,
  fileNameBase: string,
  options?: Pick<ElementPdfSaveOptions, "fitSinglePage" | "marginMm">
): void {
  const fitSinglePage = options?.fitSinglePage ?? false;
  const marginMm = Number.isFinite(Number(options?.marginMm))
    ? Math.max(0, Number(options?.marginMm))
    : 8;

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = Math.max(1, pageWidth - marginMm * 2);
  const maxHeight = Math.max(1, pageHeight - marginMm * 2);
  const fullWidthHeight = (capture.height * maxWidth) / capture.width;

  if (fitSinglePage) {
    let renderWidth = maxWidth;
    let renderHeight = fullWidthHeight;
    if (renderHeight > maxHeight) {
      const factor = maxHeight / renderHeight;
      renderHeight = maxHeight;
      renderWidth = renderWidth * factor;
    }
    const offsetX = (pageWidth - renderWidth) / 2;
    const offsetY = (pageHeight - renderHeight) / 2;
    pdf.addImage(capture.imgData, "JPEG", offsetX, offsetY, renderWidth, renderHeight);
    const safe = sanitizeFileNameBase(fileNameBase) || "report";
    pdf.save(`${safe}.pdf`);
    return;
  }

  const imgWidth = maxWidth;
  const imgHeight = fullWidthHeight;
  let heightLeft = imgHeight;
  let position = marginMm;

  pdf.addImage(capture.imgData, "JPEG", marginMm, position, imgWidth, imgHeight);
  heightLeft -= maxHeight;

  while (heightLeft > 0) {
    position = marginMm + (heightLeft - imgHeight);
    pdf.addPage();
    pdf.addImage(capture.imgData, "JPEG", marginMm, position, imgWidth, imgHeight);
    heightLeft -= maxHeight;
  }

  const safe = sanitizeFileNameBase(fileNameBase) || "report";
  pdf.save(`${safe}.pdf`);
}

/**
 * DOM 노드를 캡처해 A4 세로 PDF로 저장합니다. 긴 콘텐츠는 여러 페이지로 나눕니다.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  fileNameBase: string,
  options?: ElementPdfSaveOptions
): Promise<void> {
  const capture = await captureElementForPdf(element, options);
  saveElementPdfCapture(capture, fileNameBase, options);
}
