import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
export const clampDocumentZoom = (value: number) =>
  Math.max(0.25, Math.min(4, value));
export function pinchDocumentZoom(zoom: number, delta: number) {
  return clampDocumentZoom(zoom * Math.exp(-delta * 0.01));
}
export function useDocumentGestures(
  stage: RefObject<HTMLDivElement | null>,
  dialog: RefObject<HTMLDialogElement | null>,
  zoom: number,
  setZoom: Dispatch<SetStateAction<number>>,
  enabled: boolean,
) {
  const current = useRef(zoom),
    pending = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    current.current = zoom;
    const el = stage.current;
    if (el && pending.current) {
      el.scrollLeft = pending.current.x;
      el.scrollTop = pending.current.y;
      pending.current = null;
    }
  }, [zoom]);
  useEffect(() => {
    const el = stage.current,
      root = dialog.current;
    if (!el || !root || !enabled) return;
    const apply = (next: number, x: number, y: number, dx = 0, dy = 0) => {
      const rect = el.getBoundingClientRect(),
        ratio = next / current.current;
      pending.current = {
        x: (el.scrollLeft + x - rect.left) * ratio - (x - rect.left) - dx,
        y: (el.scrollTop + y - rect.top) * ratio - (y - rect.top) - dy,
      };
      current.current = next;
      setZoom(next);
      if (ratio === 1) {
        el.scrollLeft = pending.current.x;
        el.scrollTop = pending.current.y;
        pending.current = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      apply(pinchDocumentZoom(current.current, e.deltaY), e.clientX, e.clientY);
    };
    let touch: { distance: number; x: number; y: number } | null = null;
    const point = (e: TouchEvent) => {
      const a = e.touches[0],
        b = e.touches[1];
      return a && b
        ? {
            distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            x: (a.clientX + b.clientX) / 2,
            y: (a.clientY + b.clientY) / 2,
          }
        : null;
    };
    const start = (e: TouchEvent) => {
      touch = point(e);
      if (touch) e.preventDefault();
    };
    const move = (e: TouchEvent) => {
      const next = point(e);
      if (!next || !touch) return;
      e.preventDefault();
      apply(
        clampDocumentZoom(
          (current.current * next.distance) / Math.max(1, touch.distance),
        ),
        next.x,
        next.y,
        next.x - touch.x,
        next.y - touch.y,
      );
      touch = next;
    };
    const end = () => {
      touch = null;
    };
    root.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      root.removeEventListener("wheel", wheel);
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [enabled, setZoom, stage, dialog]);
}
