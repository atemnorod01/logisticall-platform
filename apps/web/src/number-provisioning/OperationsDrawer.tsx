import { useEffect, useRef, type ReactNode } from "react";
export function OperationsDrawer({
  title,
  children,
  footer,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="integration-drawer operations-drawer"
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (
          !busy &&
          e.target === e.currentTarget &&
          (e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom)
        )
          ref.current?.close();
      }}
    >
      <div className="drawer-heading">
        <h2>{title}</h2>
        <button
          className="close"
          aria-label="Close drawer"
          disabled={busy}
          onClick={() => ref.current?.close()}
        >
          ×
        </button>
      </div>
      <div className="drawer-content">{children}</div>
      <div className="drawer-footer">
        {footer ?? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => ref.current?.close()}
          >
            Close
          </button>
        )}
      </div>
    </dialog>
  );
}
