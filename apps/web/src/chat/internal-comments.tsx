import { commentTime, continuesMessageGroup } from "./format.js";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { InternalComment } from "../../../../packages/types/src/messaging.js";

export function InternalComments({
  comments,
  highlightedId,
  open,
  setOpen,
  shared,
  busy,
  onSend,
}: {
  comments: InternalComment[];
  highlightedId?: string | null;
  open: boolean;
  setOpen: (value: boolean) => void;
  shared: boolean;
  busy: boolean;
  onSend: (id: string, body: string) => Promise<boolean>;
}) {
  const [present, setPresent] = useState(open);
  const [expanded, setExpanded] = useState(false);
  const label = useRef<HTMLSpanElement>(null);
  const [compactWidth, setCompactWidth] = useState(210);
  const input = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let frame = 0;
    let secondFrame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          setExpanded(true);
          input.current?.focus({ preventScroll: true });
        });
      });
    } else {
      if (document.activeElement === input.current)
        toggle.current?.focus({ preventScroll: true });
      setExpanded(false);
      timeout = setTimeout(() => setPresent(false), 180);
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timeout);
    };
  }, [open]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const attempt = useRef({ id: crypto.randomUUID(), body: "" });
  const count = comments.filter((c) => !c.deletedAt).length;
  useLayoutEffect(() => {
    const element = label.current;
    if (!element) return;
    const measure = () =>
      setCompactWidth(Math.ceil(element.getBoundingClientRect().width) + 54);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, open, present]);
  async function send() {
    const body = draft.trim();
    if (!body || sending || busy) return;
    if (attempt.current.body !== body)
      attempt.current = { id: crypto.randomUUID(), body };
    setSending(true);
    setError("");
    try {
      if (await onSend(attempt.current.id, body)) {
        setDraft((current) => (current.trim() === body ? "" : current));
        attempt.current = { id: crypto.randomUUID(), body: "" };
      } else
        setError(
          "Couldn't save the comment. Your text is kept here—try again.",
        );
    } catch {
      setError("Couldn't save the comment. Please try again.");
    } finally {
      setSending(false);
    }
  }
  const groups: InternalComment[][] = [];
  for (const comment of comments) {
    const previous = groups.at(-1)?.at(-1);
    if (
      previous &&
      continuesMessageGroup(
        { ...comment, internal: true },
        { ...previous, internal: true },
      )
    )
      groups.at(-1)!.push(comment);
    else groups.push([comment]);
  }
  if (!open && !present && !comments.length) return null;
  return (
    <section
      className="lc-internal-thread"
      aria-label="Internal comments"
      style={
        {
          "--thread-width": `${expanded ? 480 : compactWidth}px`,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="lc-internal-thread-toggle"
        ref={toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="lc-internal-thread-label" ref={label}>
          <span aria-hidden="true">🔒</span>{" "}
          {count
            ? `${count} internal ${count === 1 ? "comment" : "comments"}`
            : "Internal comment"}
        </span>
        <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
      <div
        className={`lc-internal-thread-expand ${expanded ? "is-expanded" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="lc-internal-thread-content">
          <div className="lc-internal-thread-comments">
            {groups.map((group) => (
              <div className="lc-comment-group" key={group[0]!.id}>
                {group.map((c, i) => {
                  const continuation = i > 0;
                  return (
                    <article
                      key={c.id}
                      data-search-match={c.id === highlightedId || undefined}
                      className={
                        continuation ? "lc-comment-continuation" : undefined
                      }
                    >
                      {!continuation && (
                        <header>
                          <strong>
                            {c.author}
                            {c.own ? " (you)" : ""}
                          </strong>
                          <time dateTime={c.createdAt}>
                            {commentTime(c.createdAt)}
                          </time>
                        </header>
                      )}
                      <p>{c.deletedAt ? "Comment deleted." : c.body}</p>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
          <form
            className="lc-internal-thread-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="lc-internal-comment-input">
              <textarea
                ref={input}
                title="Enter to send · Shift+Enter for a new line"
                aria-label="Internal comment"
                placeholder={
                  count ? "Reply internally…" : "Write an internal comment…"
                }
                maxLength={20000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    if (!e.repeat) void send();
                  }
                }}
              />
              <button
                type="submit"
                disabled={busy || sending || !draft.trim()}
                aria-label="Send internal comment"
              >
                ↑
              </button>
            </div>
            <footer>
              <span>
                🔒{" "}
                {shared
                  ? "Only members of this inbox can see this thread."
                  : "Only you can see this thread in your personal inbox."}
              </span>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </footer>
            {error && <p role="alert">{error}</p>}
          </form>
        </div>
      </div>
    </section>
  );
}
