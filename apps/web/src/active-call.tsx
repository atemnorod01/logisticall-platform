import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar, Icon } from "./ui.js";
import { CallAudioPicker } from "./call-audio-picker.js";
import { openCallWindow } from "./call-window.js";
import type { Calling } from "./calls-ui.js";
import "./styles/active-call.css";

type Props = {
  calling: Calling;
  seconds: number;
  openingConversation: boolean;
  conversationError: string;
  openConversation: () => Promise<void>;
};
export function ActiveCallPanel({
  calling,
  seconds,
  openingConversation,
  conversationError,
  openConversation,
}: Props) {
  const { state, controller, user } = calling;
  const call = state.current;
  const other = call ? (call.caller.id === user ? call.callee : call.caller) : state.outgoingTarget;
  const owns = call ? controller.owns(call) : state.preparing;
  const pending = !call?.acceptedAt;
  const pendingStatus = state.preparing ? "Calling…" : "Ringing…";
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const popup = useRef<ReturnType<typeof openCallWindow>>(null);
  const [windowError, setWindowError] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 650px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 650px)");
    const changed = () => setNarrow(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const returnButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      popup.current?.close();
      popup.current = null;
    },
    [],
  );
  function dock() {
    popup.current?.close();
    popup.current = null;
    setTarget(null);
    setWindowError("");
  }
  function undock() {
    if (popup.current) {
      popup.current.focus();
      return;
    }
    const next = openCallWindow(() => {
      popup.current = null;
      setTarget(null);
    });
    if (!next) {
      setWindowError(
        "Allow pop-up windows for LogistiCall to undock this call.",
      );
      return;
    }
    popup.current = next;
    setTarget(next.root);
    setWindowError("");
  }
  // Keep the narrow-screen call view keyboard accessible; collapse it with Escape.
  useEffect(() => {
    if (target || minimized) return;
    const media = window.matchMedia("(max-width: 650px)");
    const workspace = document.querySelector<HTMLElement>(
      ".lc-call-docked > .workspace",
    );
    const previous = document.activeElement as HTMLElement | null;
    const wasInert = workspace?.inert ?? false;
    const sync = () => {
      if (workspace) workspace.inert = media.matches || wasInert;
      if (media.matches) returnButton.current?.focus();
    };
    sync();
    media.addEventListener("change", sync);
    const escape = (event: KeyboardEvent) => {
      if (!media.matches) return;
      if (event.key === "Escape") setMinimized(true);
      if (event.key === "Tab") {
        const panel = returnButton.current?.closest("aside");
        const buttons = [
          ...(panel?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? []),
        ].filter((button) => button.getClientRects().length);
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("keydown", escape);
      if (workspace) workspace.inert = wasInert;
      if (media.matches) previous?.focus();
    };
  }, [target, minimized, narrow]);
  const status = !owns
    ? "On another device"
    : pending
      ? pendingStatus
      : state.held
      ? "On hold"
      : state.connected
        ? state.muted
          ? "Microphone muted"
          : "Connected"
        : "Connecting audio…";
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const controls = (
    <div className="lc-active-controls">
      <button
        className="lc-active-control"
        onClick={controller.mute}
        disabled={!owns || pending}
        aria-pressed={state.muted}
        aria-label={state.muted ? "Unmute microphone" : "Mute microphone"}
        title={state.muted ? "Unmute" : "Mute"}
      >
        <Icon name={state.muted ? "mic-off" : "mic"} />
        <span>{state.muted ? "Unmute" : "Mute"}</span>
      </button>
      <button
        className="lc-active-control"
        onClick={controller.hold}
        disabled={!owns || pending}
        aria-pressed={state.held}
        aria-label={state.held ? "Resume call" : "Hold call"}
        title={state.held ? "Resume" : "Hold"}
      >
        <Icon name={state.held ? "play" : "pause"} />
        <span>{state.held ? "Resume" : "Hold"}</span>
      </button>
      <button
        className="lc-active-control lc-active-pstn"
        disabled
        aria-label="Dial pad — available with PSTN calling"
        title="Dial pad — available with PSTN calling"
      >
        <Icon name="dialpad" />
        <span>Dial pad</span>
      </button>
      <button
        className="lc-active-control lc-active-pstn"
        disabled
        aria-label="Add call — available with PSTN calling"
        title="Add call — available with PSTN calling"
      >
        <Icon name="user-plus" />
        <span>Add call</span>
      </button>
      <button
        className="lc-active-control lc-active-pstn"
        disabled
        aria-label="Transfer call — available with PSTN calling"
        title="Transfer call — available with PSTN calling"
      >
        <Icon name="call-transfer" />
        <span>Transfer</span>
      </button>
      <CallAudioPicker controller={controller} disabled={!owns || pending} />
      <button
        className="lc-active-control lc-active-hangup"
        onClick={() => void controller.end()}
        disabled={!owns}
        aria-label={pending ? "Cancel call" : "Hang up"}
        title={pending ? "Cancel call" : "Hang up"}
      >
        <Icon name="phone" />
        <span>{pending ? "Cancel call" : "Hang up"}</span>
      </button>
    </div>
  );
  const content = (
    <aside
      className={`lc-active-call lc-call-bar${target ? " lc-active-detached" : ""}${target || (narrow && !minimized) ? " lc-active-expanded" : ""}${minimized && !target ? " lc-active-minimized" : ""}`}
      aria-label={pending ? "Outgoing voice call" : "Active voice call"}
    >
      <header className="lc-active-heading">
        <button
          ref={returnButton}
          onClick={() => (target ? dock() : setMinimized(true))}
          aria-label={target ? "Dock call" : "Return to conversation"}
        >
          <Icon name="arrow-left" />
        </button>
        <span>{pending ? "Outgoing call" : "Active call"}</span>
        <button
          onClick={target ? dock : undock}
          aria-label={target ? "Dock call" : "Undock call"}
          title={target ? "Dock call" : "Undock call"}
        >
          <Icon name={target ? "dock" : "undock"} />
        </button>
      </header>
      <div className="lc-active-identity">
        <Avatar name={other?.name ?? "Voice call"} />
        <div className="lc-active-summary">
          <h2>{other?.name ?? "Voice call"}</h2>
          <p
            title={[other?.organizationName, call?.team?.name, status]
              .filter(Boolean)
              .join(" · ")}
          >
            {other?.organizationName && <>{other?.organizationName} · </>}
            <span role="status">{status}</span>
          </p>
        </div>
      </div>
      <span
        className="lc-active-duration"
        aria-label={pending ? "Call status" : "Call duration"}
        aria-live="off"
      >
        {pending ? pendingStatus : duration}
      </span>
      <div className="lc-active-utilities">
        {call?.conversationId && (
          <button
            onClick={() => {
              window.focus();
              setMinimized(true);
              void openConversation();
            }}
            disabled={openingConversation}
            aria-label="Open chat"
            title="Open chat"
          >
            <Icon name="message" />
          </button>
        )}
        <button onClick={undock} aria-label="Undock call" title="Undock call">
          <Icon name="undock" />
        </button>
      </div>
      {controls}
      <button className="lc-active-expand" onClick={() => setMinimized(false)}>
        Show call <Icon name="chevron" />
      </button>
      {(state.error ||
        conversationError ||
        windowError ||
        state.audioBlocked) && (
        <div className="lc-active-feedback" role="alert">
          {state.error || conversationError || windowError}
          {state.error && (
            <button onClick={controller.clearError}>Dismiss</button>
          )}
          {state.audioBlocked && (
            <button onClick={controller.play}>Play call audio</button>
          )}
        </div>
      )}
      {target && (
        <p className="lc-active-window-note">
          Keep the main LogistiCall tab open.
        </p>
      )}
    </aside>
  );
  if (!target) return content;
  return (
    <>
      <aside className="lc-call-window-return">
        <span>
          Call with {other?.name ?? "Voice call"} · {pending ? pendingStatus : duration}
        </span>
        <button onClick={() => popup.current?.focus()}>Show call window</button>
        <button onClick={dock}>Dock call</button>
      </aside>
      {createPortal(content, target)}
    </>
  );
}
