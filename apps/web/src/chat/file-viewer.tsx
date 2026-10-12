import { LoadingSkeleton } from "../loading-skeleton.js";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../../../../packages/types/src/messaging.js";
import { loadDocument, loadPdf, type DocumentData } from "./document-data.js";
import { useDocumentGestures } from "./document-gestures.js";
import { FileThumbnail } from "./file-thumbnail.js";

export function FileViewer({
  files,
  selected,
  url,
  sender,
  sentAt,
  onClose,
}: {
  files: Attachment[];
  selected: number;
  url: (id: string) => string;
  sender?: string;
  sentAt?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(selected),
    [zoom, setZoom] = useState(1);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const file = files[index]!;
  const media = /^(audio|video)\//.test(file.mime);
  useDocumentGestures(stage, dialog, zoom, setZoom, !media);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function select(next: number) {
    setIndex(next);
    setZoom(1);
    stage.current?.scrollTo(0, 0);
  }
  return (
    <dialog
      ref={dialog}
      data-portal-zoom="viewer"
      className="lc-gallery lc-document-gallery"
      aria-label="Attachment preview"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="lc-gallery-header">
        <button
          type="button"
          aria-label="Close attachment preview"
          onClick={onClose}
        >
          ←
        </button>
        <div className="lc-gallery-caption">
          <strong>{sender || file.filename}</strong>
          <small>
            {file.filename}
            {sentAt ? ` · ${new Date(sentAt).toLocaleString()}` : ""}{" "}
            <button type="button" onClick={onClose}>
              Show message
            </button>
          </small>
        </div>
        <div className="lc-gallery-tools">
          {!media && (
            <>
              <button
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
              >
                −
              </button>
              <button
                aria-label="Reset zoom to initial size"
                onClick={() => {
                  setZoom(1);
                  stage.current?.scrollTo(0, 0);
                }}
              >
                Reset zoom
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
              >
                +
              </button>
            </>
          )}
          <a
            href={url(file.id)}
            download={file.filename}
            aria-label={`Download ${file.filename}`}
          >
            ↓
          </a>
        </div>
      </header>
      <div className="lc-document-fixed-controls" ref={setControls} />
      <div
        ref={stage}
        className="lc-document-stage"
        role="region"
        aria-label="Document pages"
        tabIndex={0}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          key={file.id}
          className="lc-document-content"
          style={{ zoom: media ? 1 : zoom }}
        >
          {file.mime === "application/pdf" ? (
            <PdfDocument url={url(file.id)} controls={controls} />
          ) : file.mime.startsWith("video/") ? (
            <video controls playsInline preload="metadata" src={url(file.id)} />
          ) : file.mime.startsWith("audio/") ? (
            <div className="lc-audio-player">
              <span aria-hidden="true">♫</span>
              <strong>{file.filename}</strong>
              <audio controls preload="metadata" src={url(file.id)} />
            </div>
          ) : file.mime.startsWith("image/") ? (
            <img src={url(file.id)} alt={file.filename} />
          ) : (
            <OfficeDocument
              url={url(file.id)}
              mime={file.mime}
              controls={controls}
            />
          )}
        </div>
      </div>
      <footer className="lc-document-filmstrip">
        <button
          disabled={index === 0}
          onClick={() => select(index - 1)}
          aria-label="Previous attachment"
        >
          ‹
        </button>
        {files.map((f, i) => (
          <button
            key={f.id}
            aria-label={`View ${f.filename}`}
            aria-current={i === index}
            onClick={() => select(i)}
          >
            <FileThumbnail url={url(f.id)} mime={f.mime} name={f.filename} />
          </button>
        ))}
        <button
          disabled={index === files.length - 1}
          onClick={() => select(index + 1)}
          aria-label="Next attachment"
        >
          ›
        </button>
      </footer>
    </dialog>
  );
}
function OfficeDocument({
  url,
  mime,
  controls,
}: {
  url: string;
  mime: string;
  controls: HTMLDivElement | null;
}) {
  const [data, setData] = useState<DocumentData | null>(null),
    [error, setError] = useState("");
  const [sheet, setSheet] = useState(0),
    [row, setRow] = useState(0),
    [col, setCol] = useState(0);
  useEffect(() => {
    let live = true;
    void loadDocument(url, mime)
      .then((value) => {
        if (live) setData(value);
      })
      .catch(() => {
        if (live)
          setError(
            "Preview unavailable for this file. Download the original to open it.",
          );
      });
    return () => {
      live = false;
    };
  }, [url, mime]);
  if (error) return <p role="status">{error}</p>;
  if (!data) return <LoadingSkeleton variant="details" rows={5} label="Loading document" />;
  if (data.kind === "docx")
    return (
      <article
        className="lc-document-page"
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    );
  if (data.kind === "text")
    return <pre className="lc-document-page lc-text-document">{data.text}</pre>;
  const ws = data.workbook.worksheets[sheet];
  if (!ws) return <p>Empty workbook</p>;
  const rows = Math.max(1, ws.rowCount),
    cols = Math.max(1, ws.columnCount);
  return (
    <section className="lc-workbook">
      {controls &&
        createPortal(
          <>
            <nav aria-label="Workbook sheets">
              {data.workbook.worksheets.map((w, i) => (
                <button
                  key={w.id}
                  aria-pressed={i === sheet}
                  onClick={() => {
                    setSheet(i);
                    setRow(0);
                    setCol(0);
                  }}
                >
                  {w.name}
                </button>
              ))}
            </nav>
            <div className="lc-sheet-controls">
              <button
                disabled={!row}
                onClick={() => setRow(Math.max(0, row - 100))}
              >
                Previous rows
              </button>
              <span>
                Rows {row + 1}–{Math.min(rows, row + 100)} of {rows}
              </span>
              <button
                disabled={row + 100 >= rows}
                onClick={() => setRow(row + 100)}
              >
                Next rows
              </button>
              <button
                disabled={!col}
                onClick={() => setCol(Math.max(0, col - 26))}
              >
                Previous columns
              </button>
              <span>
                Columns {col + 1}–{Math.min(cols, col + 26)} of {cols}
              </span>
              <button
                disabled={col + 26 >= cols}
                onClick={() => setCol(col + 26)}
              >
                Next columns
              </button>
            </div>
          </>,
          controls,
        )}
      <table>
        <thead>
          <tr>
            <th></th>
            {Array.from({ length: Math.min(26, cols - col) }, (_, c) => (
              <th key={c}>{ws.getColumn(col + c + 1).letter}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.min(100, rows - row) }, (_, r) => (
            <tr key={r}>
              <th>{row + r + 1}</th>
              {Array.from({ length: Math.min(26, cols - col) }, (_, c) => {
                const cell = ws.getCell(row + r + 1, col + c + 1);
                return (
                  <td
                    key={c}
                    style={{
                      fontWeight: cell.font?.bold ? "bold" : undefined,
                      fontStyle: cell.font?.italic ? "italic" : undefined,
                    }}
                  >
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function PdfDocument({
  url,
  controls,
}: {
  url: string;
  controls: HTMLDivElement | null;
}) {
  const pdf = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1),
    [count, setCount] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let destroy: (() => void) | undefined;
    void (async () => {
      try {
        const task = await loadPdf(url);
        destroy = () => void task.destroy();
        if (!live) {
          destroy();
          return;
        }
        const doc = await task.promise;
        if (live) {
          pdf.current = doc;
          setCount(doc.numPages);
        }
      } catch {
        if (live)
          setError(
            "Unable to preview this PDF. Download it to open the original.",
          );
      }
    })();
    return () => {
      live = false;
      pdf.current = null;
      destroy?.();
    };
  }, [url]);
  return (
    <section className="lc-pdf-document">
      {controls &&
        createPortal(
          <div className="lc-sheet-controls">
            <button
              disabled={page <= 1}
              onClick={() =>
                document
                  .getElementById(`pdf-page-${page - 1}`)
                  ?.scrollIntoView({ block: "start" })
              }
            >
              Previous page
            </button>
            <span>
              Page {page} / {count || "…"}
            </span>
            <button
              disabled={!count || page >= count}
              onClick={() =>
                document
                  .getElementById(`pdf-page-${page + 1}`)
                  ?.scrollIntoView({ block: "start" })
              }
            >
              Next page
            </button>
          </div>,
          controls,
        )}
      {error ? (
        <p role="status">{error}</p>
      ) : (
        pdf.current &&
        Array.from({ length: count }, (_, i) => (
          <PdfPage
            key={i}
            pdf={pdf.current!}
            page={i + 1}
            onVisible={setPage}
          />
        ))
      )}
    </section>
  );
}

function PdfPage({
  pdf,
  page,
  onVisible,
}: {
  pdf: import("pdfjs-dist").PDFDocumentProxy;
  page: number;
  onVisible: (n: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const root = el.closest(".lc-document-stage");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setNear(e.isIntersecting);
      },
      { root, rootMargin: "800px" },
    );
    observer.observe(el);
    const active = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) onVisible(page);
      },
      { root, rootMargin: "-10% 0px -70% 0px" },
    );
    active.observe(el);
    void pdf
      .getPage(page)
      .then((p) => {
        const v = p.getViewport({ scale: 1 });
        el.style.width = `${v.width}px`;
        el.style.minHeight = `${v.height}px`;
      })
      .catch(() => setError("Unable to load this page."));
    return () => {
      observer.disconnect();
      active.disconnect();
    };
  }, [pdf, page, onVisible]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    let task: import("pdfjs-dist").RenderTask | undefined;
    void pdf
      .getPage(page)
      .then(async (p) => {
        if (!live || !canvas.current) return;
        const v = p.getViewport({ scale: 1.5 });
        canvas.current.width = v.width;
        canvas.current.height = v.height;
        canvas.current.style.width = `${v.width / 1.5}px`;
        task = p.render({ canvas: canvas.current, viewport: v });
        await task.promise;
      })
      .catch((e) => {
        if (live && e?.name !== "RenderingCancelledException")
          setError("Unable to render this page.");
      });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [pdf, page, near]);
  return (
    <div
      ref={holder}
      id={`pdf-page-${page}`}
      className="lc-pdf-page"
      aria-label={`Page ${page}`}
      style={{ width: 612, minHeight: 792 }}
    >
      {error ? (
        <p role="status">{error}</p>
      ) : near ? (
        <canvas ref={canvas} />
      ) : (
        <span>Page {page}</span>
      )}
    </div>
  );
}
