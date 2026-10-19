import { useEffect, useRef, useState } from "react";
import type { NumberSelectionAction } from "./number-selection";

export function NumberSelectionMenu({
  counts,
  onAction,
}: {
  counts: Record<NumberSelectionAction, number>;
  onAction: (action: NumberSelectionAction) => void;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const actions: { key: NumberSelectionAction; label: string }[] = [
    { key: "assign", label: "Assign to organization" },
    { key: "unassign", label: "Unassign from organization" },
    { key: "release", label: "Return to carrier" },
  ];
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <div
      className="tn-selection-menu"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        Actions <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="tn-action-menu"
          role="menu"
          aria-label="Selected number actions"
          onKeyDown={(e) => {
            const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[role=menuitem]",
                ),
              ),
              index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
            const next =
              e.key === "ArrowDown"
                ? (index + 1) % items.length
                : e.key === "ArrowUp"
                  ? (index - 1 + items.length) % items.length
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : null;
            if (next !== null) {
              e.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          {actions
            .filter((a) => counts[a.key] > 0)
            .map((a) => (
              <button
                key={a.key}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAction(a.key);
                }}
              >
                <span>{a.label}</span>
                <span className="tn-action-count">{counts[a.key]}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
