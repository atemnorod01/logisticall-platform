import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  cleanRich,
  richDisplay,
  richPlain,
  richSnapshot,
  richValue,
} from "./rich-text.js";
import { mountSnippets, snippetCard } from "./code-snippets.js";
import { Modal } from "../settings-ui.js";
export type Draft = { text: string; rich: string };
export const emptyDraft: Draft = { text: "", rich: "" };
const commands = [
  ["bold", "Bold", "B"],
  ["italic", "Italic", "I"],
  ["underline", "Underline", "U"],
  ["strikeThrough", "Strikethrough", "S"],
  ["insertUnorderedList", "Bulleted list", "☷"],
  ["insertOrderedList", "Numbered list", "1."],
  ["formatBlock", "Quote", "❞"],
  ["codeBlock", "Code block", "</>"],
  ["createLink", "Insert link", "↗"],
  ["removeFormat", "Clear formatting", "Tx"],
];
export function RichEditor({
  id,
  value,
  onChange,
  onSend,
  onCancel,
  onClear,
  onFiles,
  reference,
  disabled = false,
  label = "Message",
}: {
  reference?: ReactNode;
  id: string;
  value: Draft;
  onChange: (v: Draft) => void;
  onSend: () => void;
  onCancel?: () => void;
  onClear?: () => void;
  onFiles?: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    last = useRef(""),
    range = useRef<Range | null>(null);
  const [expanded, setExpanded] = useState(false),
    [fontSize, setFontSize] = useState("3"),
    [link, setLink] = useState<string | null>(null),
    [drag, setDrag] = useState(false);
  function snapshot() {
    const el = ref.current;
    if (!el) return;
    const next = { text: richPlain(el), rich: richSnapshot(el) };
    last.current = JSON.stringify(next);
    onChange(next);
    mountSnippets(snapshot);
    if (el.scrollHeight > el.clientHeight && /\n$/.test(next.text))
      el.scrollTop = el.scrollHeight;
  }
  useLayoutEffect(() => {
    if (ref.current && last.current !== JSON.stringify(value)) {
      ref.current.innerHTML = richValue(value.rich, value.text);
      last.current = JSON.stringify(value);
      mountSnippets(snapshot);
    }
  }, [value]);
  useLayoutEffect(() => {
    if (label === "Edit message") ref.current?.focus({ preventScroll: true });
  }, [id]);
  function rememberSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount && ref.current?.contains(selection.anchorNode))
      range.current = selection.getRangeAt(0).cloneRange();
  }
  function resizeText(size: string) {
    ref.current?.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (range.current) {
      selection?.removeAllRanges();
      selection?.addRange(range.current);
    }
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("fontSize", false, size);
    setFontSize(size);
    snapshot();
  }
  function command(cmd: string) {
    const el = ref.current;
    if (!el) return;
    rememberSelection();
    if (cmd === "createLink") {
      setLink("");
      return;
    }
    el.focus({ preventScroll: true });
    if (cmd === "codeBlock") {
      document.execCommand(
        "insertHTML",
        false,
        snippetCard(window.getSelection()?.toString() ?? "", "auto", true) +
          "<div><br></div>",
      );
    } else
      document.execCommand(
        cmd,
        false,
        cmd === "formatBlock" ? "blockquote" : undefined,
      );
    snapshot();
  }
  return (
    <div className={`lc-rich-editor ${drag ? "drag-over" : ""} ${expanded ? "formatting-open" : ""}`}>
      {reference}
      <div className="lc-writing-area">
      <div
        id={id}
        ref={ref}
        className="lc-rich-input"
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        title={expanded ? "Enter for a new line · Ctrl+Enter to send" : "Enter to send · Shift+Enter for a new line"}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder="Type a message…"
        onInput={snapshot}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
            return;
          if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
            return;
          }
          const node = window.getSelection()?.anchorNode;
          const pre = (
            node?.nodeType === 1 ? (node as Element) : node?.parentElement
          )?.closest("pre");
          if (e.key === "Tab" && pre) {
            e.preventDefault();
            document.execCommand("insertText", false, "  ");
            snapshot();
          }
          if (
            e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey &&
            (expanded ? e.ctrlKey : !e.ctrlKey && !pre)
          ) {
            e.preventDefault();
            if (!e.repeat) onSend();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const files = Array.from(e.clipboardData.files);
          if (files.length && onFiles) {
            onFiles(files);
            return;
          }
          const node = window.getSelection()?.anchorNode;
          const pre = (
            node?.nodeType === 1 ? (node as Element) : node?.parentElement
          )?.closest("pre");
          const html = pre ? "" : e.clipboardData.getData("text/html");
          document.execCommand(
            html ? "insertHTML" : "insertText",
            false,
            html ? cleanRich(html) : e.clipboardData.getData("text/plain"),
          );
          snapshot();
        }}
        onDragOver={(e) => {
          if (onFiles) {
            e.preventDefault();
            setDrag(true);
          }
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFiles?.(Array.from(e.dataTransfer.files));
        }}
      />
      </div>
      <button
        type="button"
        className="lc-format-toggle"
        aria-label="Toggle formatting"
        aria-expanded={expanded}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setExpanded(!expanded)}
      >
        A
      </button>
      {expanded && (
        <div
          className="lc-rich-toolbar"
          role="toolbar"
          aria-label="Text formatting"
        >
          {commands.map(([cmd, label, icon]) => (
            <button
              key={cmd}
              type="button"
              title={label}
              aria-label={label}
              disabled={disabled}
              onMouseDown={(e) => { rememberSelection(); e.preventDefault(); }}
              onClick={() => command(cmd!)}
            >
              {cmd === "bold" ? <strong>B</strong> : cmd === "italic" ? <em>I</em> : cmd === "underline" ? <u>U</u> : cmd === "strikeThrough" ? <s>S</s> : cmd === "createLink" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/></svg> : icon}
            </button>
          ))}
          <select aria-label="Font size" title="Font size" value={fontSize} disabled={disabled}
            onPointerDown={rememberSelection} onFocus={rememberSelection}
            onChange={e => resizeText(e.target.value)}>
            <option value="2">Small</option><option value="3">Normal</option><option value="5">Large</option>
          </select>
        </div>
      )}
      {expanded && <button type="button" className="lc-clear-draft" aria-label="Discard draft" title="Discard draft" disabled={disabled}
        onClick={() => { range.current = null; setFontSize("3"); if (ref.current) ref.current.innerHTML = ""; last.current = JSON.stringify(emptyDraft); onChange(emptyDraft); onClear?.(); ref.current?.focus({preventScroll:true}); }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>
      </button>}
      {link !== null && createPortal(
        <Modal title="Insert link" onClose={() => setLink(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!/^https?:\/\//i.test(link)) return;
              // A modal makes the editor inert: close it before restoring selection.
              e.currentTarget.closest("dialog")?.close();
              ref.current?.focus({ preventScroll: true });
              const selection = window.getSelection();
              if (range.current) {
                selection?.removeAllRanges();
                selection?.addRange(range.current);
              }
              document.execCommand("createLink", false, link);
              snapshot();
              setLink(null);
            }}
          >
            <label>
              Web address
              <input
                type="url"
                required
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://"
              />
            </label>
            <button className="button" type="submit">
              Insert link
            </button>
          </form>
        </Modal>, document.body
      )}
    </div>
  );
}
export function RichBody({ rich, text }: { rich: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    mountSnippets(() => {});
  }, [rich, text]);
  return (
    <div
      ref={ref}
      className="lc-message-body lc-rich-body"
      dangerouslySetInnerHTML={{
        __html: rich ? richDisplay(rich) : richValue("", text),
      }}
    />
  );
}
