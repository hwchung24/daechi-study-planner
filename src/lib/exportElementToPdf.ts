import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function sanitizeFileNameBase(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * DOM 노드를 캡처해 A4 세로 PDF로 저장합니다. 긴 콘텐츠는 여러 페이지로 나눕니다.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  fileNameBase: string,
  options?: {
    /** 캡처에서 제외할 요소에 붙인 클래스명 (해당 노드와 자손은 그대로 두고, 일치하는 요소만 제외) */
    ignoreClassName?: string;
    /** true면 A4 1페이지 안에 축소해서 배치 */
    fitSinglePage?: boolean;
    /** 페이지 여백(mm), 기본 8 */
    marginMm?: number;
  }
): Promise<void> {
  const ignoreClass = options?.ignoreClassName || "pdf-export-skip";
  const fitSinglePage = options?.fitSinglePage ?? false;
  const marginMm = Number.isFinite(Number(options?.marginMm))
    ? Math.max(0, Number(options?.marginMm))
    : 8;

  const canvas = await html2canvas(element, {
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

  const imgData = canvas.toDataURL("image/jpeg", 0.92);
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = Math.max(1, pageWidth - marginMm * 2);
  const maxHeight = Math.max(1, pageHeight - marginMm * 2);
  const fullWidthHeight = (canvas.height * maxWidth) / canvas.width;

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
    pdf.addImage(imgData, "JPEG", offsetX, offsetY, renderWidth, renderHeight);
    const safe = sanitizeFileNameBase(fileNameBase) || "report";
    pdf.save(`${safe}.pdf`);
    return;
  }

  const imgWidth = maxWidth;
  const imgHeight = fullWidthHeight;
  let heightLeft = imgHeight;
  let position = marginMm;

  pdf.addImage(imgData, "JPEG", marginMm, position, imgWidth, imgHeight);
  heightLeft -= maxHeight;

  while (heightLeft > 0) {
    position = marginMm + (heightLeft - imgHeight);
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", marginMm, position, imgWidth, imgHeight);
    heightLeft -= maxHeight;
  }

  const safe = sanitizeFileNameBase(fileNameBase) || "report";
  pdf.save(`${safe}.pdf`);
}
