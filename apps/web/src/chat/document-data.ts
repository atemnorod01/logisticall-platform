import DOMPurify from "dompurify";
import {
  DOCX,
  XLSX,
  validateOffice,
} from "../../../../packages/types/src/attachment-formats.js";
export type DocumentData =
  | { kind: "docx"; html: string }
  | { kind: "xlsx"; workbook: import("exceljs").Workbook }
  | { kind: "text"; text: string };
const cache = new Map<string, Promise<DocumentData>>();
export function loadDocument(url: string, mime: string): Promise<DocumentData> {
  const key = `${mime}:${url}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const task = (async (): Promise<DocumentData> => {
    const response = await fetch(url);
    if (!response.ok) throw Error("Document unavailable");
    const data = await response.arrayBuffer();
    if (data.byteLength > 26214400) throw Error("Document exceeds 25 MB");
    if (
      (mime === DOCX || mime === XLSX) &&
      !validateOffice(new Uint8Array(data), mime)
    )
      throw Error("Unsupported or oversized document archive");
    if (mime === DOCX) {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml(
        { arrayBuffer: data },
        { externalFileAccess: false },
      );
      const html = DOMPurify.sanitize(result.value, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
          "style",
          "iframe",
          "form",
          "input",
          "button",
          "video",
          "audio",
        ],
        FORBID_ATTR: ["style", "srcset"],
      });
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("img").forEach((img) => {
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.src))
          img.remove();
      });
      doc.querySelectorAll("a").forEach((a) => {
        if (!/^https?:\/\//i.test(a.getAttribute("href") ?? ""))
          a.removeAttribute("href");
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      });
      return { kind: "docx", html: doc.body.innerHTML };
    }
    if (mime === XLSX) {
      const excel = await import("exceljs");
      const workbook = new excel.Workbook();
      await workbook.xlsx.load(data);
      return { kind: "xlsx", workbook };
    }
    return { kind: "text", text: new TextDecoder().decode(data) };
  })();
  if (cache.size >= 3) cache.delete(cache.keys().next().value!);
  cache.set(key, task);
  void task.catch(() => cache.delete(key));
  return task;
}
export async function loadPdf(url: string) {
  const library = await import("pdfjs-dist");
  library.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const assets = `${import.meta.env.BASE_URL}pdfjs/`;
  return library.getDocument({
    url,
    wasmUrl: `${assets}wasm/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    iccUrl: `${assets}iccs/`,
  });
}
