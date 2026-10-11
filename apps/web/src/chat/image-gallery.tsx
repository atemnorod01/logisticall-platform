import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../../../../packages/types/src/messaging.js";

type Point = { x: number; y: number };
const clampZoom = (value: number) => Math.max(0.25, Math.min(8, value));
export function ImageGallery({
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
  sender: string;
  sentAt: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const [index, setIndex] = useState(selected);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(false);
  const file = files[index]!;
  const fit =
    natural.width && bounds.width
      ? Math.min(bounds.width / natural.width, bounds.height / natural.height)
      : 1;
  function select(next: number) {
    if (next < 0 || next >= files.length) return;
    pointers.current.clear();
    setIndex(next);
    setView({ zoom: 1, x: 0, y: 0 });
    setNatural({ width: 0, height: 0 });
    setError(false);
  }
  function zoom(factor: number) {
    setView((v) => {
      const z = clampZoom(v.zoom * factor),
        ratio = z / v.zoom;
      return { zoom: z, x: v.x * ratio, y: v.y * ratio };
    });
  }
  useEffect(() => {
    dialog.current?.showModal();
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setBounds({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(el);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      // Trackpad pinch is deliberately disabled; vertical scrolling controls zoom.
      if (event.ctrlKey) return;
      const rect = el.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      setView((v) => {
        const z = clampZoom(
            v.zoom *
              Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.004)),
          ),
          ratio = z / v.zoom;
        return {
          zoom: z,
          x: point.x - (point.x - v.x) * ratio,
          y: point.y - (point.y - v.y) * ratio,
        };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);
  return (
    <dialog
      ref={dialog}
      data-portal-zoom="viewer"
      className="lc-gallery"
      aria-label="Image preview"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, a")) return;
        if (stage.current?.contains(target)) {
          if (gesture.current.moved) return;
          const image = stage.current.querySelector("img");
          const rect = image?.getBoundingClientRect();
          if (
            rect &&
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          )
            return;
        }
        onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          select(index - 1);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          select(index + 1);
        }
        if (e.key === "+" || e.key === "=") zoom(1.25);
        if (e.key === "-") zoom(0.8);
      }}
    >
      <header className="lc-gallery-header">
        <button
          type="button"
          aria-label="Close image preview"
          onClick={onClose}
        >
          ←
        </button>
        <div className="lc-gallery-caption">
          <strong>{sender || file.filename}</strong>
          <small>
            Shared image
            {sentAt
              ? ` · ${new Date(sentAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : ""}{" "}
            <button type="button" onClick={onClose}>
              Show message
            </button>
          </small>
        </div>
        <div className="lc-gallery-tools">
          <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom to initial size"
            title="Restore initial fit-to-screen size and center image"
            onClick={() => {
              pointers.current.clear();
              setView({ zoom: 1, x: 0, y: 0 });
            }}
          >
            Reset zoom
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>
            +
          </button>
          <a
            href={url(file.id)}
            download={file.filename}
            aria-label={`Download ${file.filename}`}
          >
            ↓
          </a>
        </div>
      </header>
      <div
        className="lc-gallery-stage"
        ref={stage}
        onDoubleClick={() =>
          setView((v) =>
            v.zoom === 1 ? { zoom: 2, x: 0, y: 0 } : { zoom: 1, x: 0, y: 0 },
          )
        }
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (pointers.current.size) gesture.current.moved = true;
          else gesture.current = { x: e.clientX, y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          if (
            Math.hypot(
              e.clientX - gesture.current.x,
              e.clientY - gesture.current.y,
            ) > 5
          )
            gesture.current.moved = true;
          const before = [...pointers.current.values()];
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const after = [...pointers.current.values()];
          const a = before[0]!,
            b = after[0]!;
          if (before.length < 2) {
            setView((v) => ({ ...v, x: v.x + b.x - a.x, y: v.y + b.y - a.y }));
            return;
          }
          const a2 = before[1]!,
            b2 = after[1]!;
          // Two fingers moving vertically zoom; their separation does not.
          const deltaY = (b.y + b2.y - (a.y + a2.y)) / 2;
          const factor = Math.exp(deltaY * 0.008);
          setView((v) => {
            const z = clampZoom(v.zoom * factor),
              ratio = z / v.zoom;
            return { zoom: z, x: v.x * ratio, y: v.y * ratio };
          });
        }}
        onPointerUp={(e) => pointers.current.delete(e.pointerId)}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
      >
        {error ? (
          <p role="status">Image unavailable. Close and reopen to retry.</p>
        ) : (
          <img
            key={file.id}
            src={url(file.id)}
            alt={file.filename}
            draggable={false}
            onError={() => setError(true)}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            style={{
              width: natural.width ? natural.width * fit : "auto",
              height: natural.height ? natural.height * fit : "auto",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          />
        )}
      </div>
      {files.length > 1 && (
        <>
          <button
            type="button"
            className="lc-gallery-prev"
            aria-label="Previous image"
            disabled={index === 0}
            onClick={() => select(index - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="lc-gallery-next"
            aria-label="Next image"
            disabled={index === files.length - 1}
            onClick={() => select(index + 1)}
          >
            ›
          </button>
        </>
      )}
      <nav className="lc-gallery-strip" aria-label="Image thumbnails">
        {files.map((f, i) => (
          <button
            key={f.id}
            type="button"
            aria-label={`View image ${i + 1}: ${f.filename}`}
            aria-current={i === index}
            onClick={() => select(i)}
          >
            <img src={url(f.id)} alt="" />
          </button>
        ))}
      </nav>
    </dialog>
  );
}
