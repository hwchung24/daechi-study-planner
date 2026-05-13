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
  }
): Promise<void> {
  const ignoreClass = options?.ignoreClassName || "pdf-export-skip";

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
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  const safe = sanitizeFileNameBase(fileNameBase) || "report";
  pdf.save(`${safe}.pdf`);
}
