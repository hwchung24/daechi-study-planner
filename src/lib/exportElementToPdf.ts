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
  const width = element.offsetWidth || 794;
  const height = element.offsetHeight || element.scrollHeight;

  return html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    width,
    height,
    scrollX: 0,
    scrollY: 0,
    windowWidth: width,
    windowHeight: height,
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

const A4_PAGE_SELECTOR = ".pgr-a4-page";

/** `.pgr-a4-page` 요소마다 캡처합니다. 없으면 루트 전체를 1장으로 캡처합니다. */
export async function captureA4PagesForPdf(
  root: HTMLElement,
  options?: ElementPdfCaptureOptions
): Promise<ElementPdfCapture[]> {
  const pages = Array.from(root.querySelectorAll<HTMLElement>(A4_PAGE_SELECTOR));
  if (!pages.length) {
    return [await captureElementForPdf(root, options)];
  }
  return Promise.all(pages.map(page => captureElementForPdf(page, options)));
}

function createA4PagesPdf(
  captures: ElementPdfCapture[],
  options?: { marginMm?: number; fillPage?: boolean }
): jsPDF {
  const marginMm = Number.isFinite(Number(options?.marginMm))
    ? Math.max(0, Number(options?.marginMm))
    : 0;
  const fillPage = options?.fillPage ?? true;

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = Math.max(1, pageWidth - marginMm * 2);
  const maxHeight = Math.max(1, pageHeight - marginMm * 2);

  captures.forEach((capture, index) => {
    if (index > 0) pdf.addPage();

    if (fillPage) {
      pdf.addImage(capture.imgData, "JPEG", 0, 0, pageWidth, pageHeight);
      return;
    }

    let renderWidth = maxWidth;
    let renderHeight = (capture.height * maxWidth) / capture.width;
    if (renderHeight > maxHeight) {
      const factor = maxHeight / renderHeight;
      renderHeight = maxHeight;
      renderWidth = renderWidth * factor;
    }
    const offsetX = (pageWidth - renderWidth) / 2;
    const offsetY = marginMm;
    pdf.addImage(capture.imgData, "JPEG", offsetX, offsetY, renderWidth, renderHeight);
  });

  return pdf;
}

/** 페이지별 캡처로 A4 PDF Blob 생성 (화면 iframe·다운로드 공통). */
export function buildA4PagesPdfBlob(
  captures: ElementPdfCapture[],
  options?: { marginMm?: number; fillPage?: boolean }
): Blob {
  if (!captures.length) {
    return new Blob([], { type: "application/pdf" });
  }
  return createA4PagesPdf(captures, options).output("blob");
}

export function downloadPdfBlob(blob: Blob, fileNameBase: string): void {
  const safe = sanitizeFileNameBase(fileNameBase) || "report";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safe}.pdf`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 페이지별 캡처를 A4 PDF 여러 장으로 저장합니다 (페이지당 1장). */
export function saveA4PagesPdfCapture(
  captures: ElementPdfCapture[],
  fileNameBase: string,
  options?: Pick<ElementPdfSaveOptions, "marginMm"> & { fillPage?: boolean }
): void {
  if (!captures.length) return;
  const pdf = createA4PagesPdf(captures, {
    marginMm: options?.marginMm ?? 0,
    fillPage: options?.fillPage ?? true
  });
  const safe = sanitizeFileNameBase(fileNameBase) || "report";
  pdf.save(`${safe}.pdf`);
}
