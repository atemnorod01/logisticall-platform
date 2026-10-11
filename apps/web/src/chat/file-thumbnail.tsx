import { useEffect, useRef, useState } from "react";
import {
  DOCX,
  XLSX,
} from "../../../../packages/types/src/attachment-formats.js";
import { loadDocument, loadPdf, type DocumentData } from "./document-data.js";
export function FileThumbnail({
  url,
  mime,
  name,
}: {
  url: string;
  mime: string;
  name: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const type =
    mime === "application/pdf"
      ? "PDF"
      : mime === DOCX
        ? "DOCX"
        : mime === XLSX
          ? "XLSX"
          : mime.startsWith("video/")
            ? "VIDEO"
            : mime.startsWith("audio/")
              ? "AUDIO"
              : mime === "text/csv"
                ? "CSV"
                : "TXT";
  useEffect(() => {
    let live = true;
    let destroy: (() => void) | undefined;
    setDocument(null);
    setFailed(false);
    if (
      !url ||
      mime.startsWith("image/") ||
      mime.startsWith("video/") ||
      mime.startsWith("audio/")
    )
      return;
    void (async () => {
      try {
        if (mime === "application/pdf") {
          const task = await loadPdf(url);
          destroy = () => void task.destroy();
          if (!live) {
            destroy();
            return;
          }
          const pdf = await task.promise;
          const page = await pdf.getPage(1);
          if (!live || !canvas.current) return;
          const viewport = page.getViewport({
            scale: 180 / page.getViewport({ scale: 1 }).width,
          });
          canvas.current.width = viewport.width;
          canvas.current.height = viewport.height;
          await page.render({ canvas: canvas.current, viewport }).promise;
        } else {
          const value = await loadDocument(url, mime);
          if (live) setDocument(value);
        }
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      destroy?.();
    };
  }, [url, mime]);
  if (mime.startsWith("image/"))
    return <img className="lc-file-thumb-image" src={url} alt={name} />;
  return (
    <span
      className={`lc-file-thumbnail lc-file-type-${type.toLowerCase()}`}
      aria-label={`${type} preview: ${name}`}
    >
      {mime === "application/pdf" && !failed && <canvas ref={canvas} />}
      {document?.kind === "docx" && (
        <span
          className="lc-mini-document"
          dangerouslySetInnerHTML={{
            __html: document.html.replace(/<\/?a\b[^>]*>/gi, ""),
          }}
        />
      )}
      {document?.kind === "xlsx" && (
        <span className="lc-mini-sheet">
          <table>
            <tbody>
              {Array.from({ length: 6 }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: 4 }, (_, c) => (
                    <td key={c}>
                      {document.workbook.worksheets[0]
                        ?.findRow(r + 1)
                        ?.findCell(c + 1)?.text ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </span>
      )}
      {document?.kind === "text" && (
        <span className="lc-mini-text">{document.text.slice(0, 350)}</span>
      )}
      {mime.startsWith("video/") && (
        <>
          <video
            src={url}
            muted
            preload="metadata"
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              e.currentTarget.currentTime = Math.min(
                0.5,
                e.currentTarget.duration / 2,
              );
            }}
            onError={() => setFailed(true)}
          />
          <span className="lc-file-play">▷</span>
        </>
      )}
      {mime.startsWith("audio/") && (
        <>
          <span className="lc-file-audio-icon" aria-hidden="true">
            ♫
          </span>
          <audio
            src={url}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setFailed(true)}
          />
        </>
      )}
      {failed && <span className="lc-file-thumb-fallback">{type}</span>}
      <span className="lc-file-type-label">
        {type}
        {Number.isFinite(duration) && duration > 0
          ? ` · ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
          : ""}
      </span>
      <span className="lc-file-thumb-name">{name}</span>
    </span>
  );
}
