import { subscribeWorkspace } from "./realtime.js";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Avatar, Icon } from "./ui.js";
import { callController } from "./calling.js";
import type { AudioCall } from "../../../packages/types/src/calls.js";
import "./styles/calls.css";
export function useCalls(
  org: string | undefined,
  user: string | undefined,
  csrf: string | undefined,
) {
  const controller = useMemo(
    () => callController(org ?? "", user ?? "", csrf ?? ""),
    [org, user, csrf],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    if (!org || !user || !csrf) return;
    void controller.sync();
    // Idle clients catch up once a minute; call transitions arrive via Realtime.
    const timer = setInterval(() => void controller.sync(), 60000);
    const unsubscribe = subscribeWorkspace(org, user, event => {
      if (event.kind === 'calls' || event.kind === 'profiles' || event.kind === 'resync') void controller.sync();
    });
    const refresh = () => void controller.sync();
    const leave = () => controller.leave();
    window.addEventListener("online", refresh);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("online", refresh);
      window.removeEventListener("pagehide", leave);
      controller.dispose();
    };
  }, [controller, org, user, csrf]);
  useEffect(() => {
    if (!state.current || state.current.status === 'ended') return;
    // Active-call liveness is a keepalive, not an idle inbox poll. It remains
    // comfortably inside the server's 35-second abandoned-call timeout.
    const heartbeat = setInterval(() => void controller.sync(), 10000);
    const deadline = state.current.status === 'ringing'
      ? setTimeout(() => void controller.sync(), Math.max(0, state.current.createdAt + (state.current.ringSeconds ?? 45) * 1000 - Date.now() + 100))
      : undefined;
    return () => { clearInterval(heartbeat); clearTimeout(deadline); };
  }, [controller, state.current?.id, state.current?.status]);
  return { controller, state, user };
}
export type Calling = ReturnType<typeof useCalls>;
export function CallPanel({ calling }: { calling: Calling }) {
  const { controller, state, user } = calling;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.current?.acceptedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.current?.acceptedAt]);
  const call = state.current,
    incoming = call && controller.incoming(call),
    ringing = incoming && call.status === "ringing";
  useEffect(() => {
    if (!ringing) return;
    const context = new AudioContext();
    const unlock = () => void context.resume();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    const ring = () => {
      if (context.state !== "running") return;
      for (const offset of [0, 0.3]) {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.frequency.value = 440;
        gain.gain.setValueAtTime(0.08, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          context.currentTime + offset + 0.2,
        );
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + 0.22);
      }
    };
    void context
      .resume()
      .then(ring)
      .catch(() => {});
    const timer = setInterval(ring, 2200);
    const title = document.title;
    document.title = "Incoming audio call · LogistiCall";
    return () => {
      clearInterval(timer);
      void context.close();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.title = title;
    };
  }, [ringing]);
  useEffect(() => {
    if (!state.voicemail || state.voicemail.phase === "sent") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.voicemail?.phase]);
  if (state.voicemail) {
    const vm = state.voicemail;
    const labels = {
      preparing: "Preparing voicemail…",
      greeting: "Listen to the greeting. Record after the beep.",
      recording: "Recording your voice message",
      sending: "Sending voice message…",
      sent: "Voice message sent",
      error: "Voicemail needs attention",
    };
    return (
      <aside
        className="lc-call-panel lc-compact-call"
        aria-label="Voicemail"
        aria-live="polite"
      >
        <header className="lc-compact-call-heading">
          <h2>
            <Icon name="phone" />
            Voicemail
          </h2>
          <span>Audio</span>
        </header>
        <div className="lc-compact-call-identity">
          <Avatar name={vm.target.name} />
          <div>
            <h3>{vm.target.name}</h3>
            {vm.target.organizationName && (
              <p className="lc-compact-call-company">
                {vm.target.organizationName}
              </p>
            )}
            <p className="lc-compact-call-status">{labels[vm.phase]}</p>
          </div>
        </div>
        {vm.phase === "recording" && (
          <p className="lc-voicemail-recording" aria-live="off">
            <span /> {Math.floor(vm.seconds / 60)}:
            {String(vm.seconds % 60).padStart(2, "0")}{" "}
            <small>Hang up to send · 5 minute limit</small>
          </p>
        )}
        {vm.error && (
          <p className="lc-compact-call-error" role="alert">
            {vm.error}
          </p>
        )}
        <div className="lc-compact-call-actions">
          {vm.phase === "recording" ? (
            <button
              className="button lc-call-end"
              onClick={controller.voicemail.finish}
            >
              <Icon name="phone" />
              Hang up &amp; send
            </button>
          ) : vm.phase === "sending" ? (
            <button className="button" disabled>
              Sending…
            </button>
          ) : (
            <button
              className="button lc-compact-cancel"
              onClick={controller.voicemail.cancel}
            >
              {vm.phase === "sent" ? "Done" : vm.file ? "Discard" : "Cancel"}
            </button>
          )}
          {vm.phase === "error" && (
            <button
              className="button primary"
              onClick={controller.voicemail.retry}
            >
              {vm.file ? "Retry sending" : "Try again"}
            </button>
          )}
          {vm.file && vm.phase === "error" && (
            <button className="button" onClick={controller.voicemail.download}>
              Download
            </button>
          )}
        </div>
      </aside>
    );
  }
  if (!call && !state.preparing && !state.error) return null;
  const other = call
    ? call.caller.id === user
      ? call.callee
      : call.caller
    : null;
  const anotherDevice =
    call && !controller.owns(call) && !(incoming && call.status === "ringing");
  const docked = Boolean(call?.acceptedAt);
  const seconds = call?.acceptedAt
    ? Math.max(0, Math.floor((now - call.acceptedAt) / 1000))
    : 0;
  if (!docked)
    return (
      <aside
        className={`lc-call-panel lc-compact-call ${ringing ? "lc-compact-incoming" : ""}`}
        aria-label={ringing ? "Incoming audio call" : "Outgoing audio call"}
        role={ringing ? "alertdialog" : "region"}
        aria-live="polite"
      >
        <header className="lc-compact-call-heading">
          <h2>
            <Icon name="phone" />
            {ringing ? "Incoming call" : "Audio call"}
          </h2>
          <span>Audio</span>
        </header>
        <div className="lc-compact-call-identity">
          <Avatar name={other?.name ?? "Audio call"} />
          <div>
            <h3>{other?.name ?? "Preparing audio…"}</h3>
            {other?.organizationName && (
              <p className="lc-compact-call-company">
                {other.organizationName}
              </p>
            )}
            <p className="lc-compact-call-status">
              {anotherDevice
                ? "Call open on another device"
                : state.preparing
                  ? ({ microphone: "Connecting microphone…", network: "Preparing audio connection…", signaling: "Starting call…" }[state.preparation])
                  : ringing
                    ? (call?.team ? `Calling ${call.team.name}…` : "Calling you…")
                    : call
                      ? "Ringing…"
                      : "Audio call"}
            </p>
          </div>
        </div>
        {state.error && (
          <p className="lc-compact-call-error" role="alert">
            {state.error}{" "}
            <button className="button" onClick={controller.clearError}>
              Dismiss
            </button>
          </p>
        )}
        {!anotherDevice && (call || state.preparing) && (
          <div className="lc-compact-call-actions">
            <button
              className={`button ${ringing ? "lc-compact-decline" : "lc-compact-cancel"}`}
              onClick={() => void controller.end()}
            >
              <Icon name="phone" />
              {ringing ? "Decline" : "Cancel call"}
            </button>
            {ringing && (
              <button
                className="button lc-compact-accept"
                disabled={state.preparing}
                onClick={() => void controller.accept()}
              >
                <Icon name="phone" />
                Accept
              </button>
            )}
          </div>
        )}
      </aside>
    );
  return (
    <aside
      className={`lc-call-panel ${ringing ? "ringing" : ""} ${docked ? "lc-call-bar" : ""}`}
      aria-label="Audio call"
      role={ringing ? "alertdialog" : "region"}
      aria-live="polite"
    >
      {docked && <Avatar name={other?.name ?? "Audio call"} />}
      <div className="lc-call-summary">
        <span className="lc-call-label">
          <Icon name="phone" /> Audio call
        </span>
        <h2>{other?.name ?? "Preparing audio…"}</h2>
        <p>
          {anotherDevice
            ? "Call open on another device"
            : state.preparing
              ? ({ microphone: "Connecting microphone…", network: "Preparing audio connection…", signaling: "Starting call…" }[state.preparation])
              : ringing
                ? "Incoming call"
                : call?.status === "ringing"
                  ? "Ringing…"
                  : state.connected
                    ? "Connected"
                    : call
                      ? "Connecting audio…"
                      : ""}
        </p>
      </div>
      {docked && (
        <span
          className="lc-call-duration"
          aria-label="Call duration"
          aria-live="off"
        >
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      )}
      {state.error && (
        <p role="alert">
          {state.error}{" "}
          <button className="button" onClick={controller.clearError}>
            Dismiss
          </button>
        </p>
      )}
      {ringing && (
        <p className="quiet">
          Keep this page open to receive calls. Your browser may require a click
          before playing the ringtone.
        </p>
      )}
      {!anotherDevice && (
        <div className="actions">
          {ringing && (
            <button
              className="button primary"
              disabled={state.preparing}
              onClick={() => void controller.accept()}
            >
              Accept
            </button>
          )}
          {call && controller.owns(call) && call.status !== "ringing" && (
            <button
              className="button"
              onClick={controller.mute}
              aria-pressed={state.muted}
            >
              {state.muted ? "Unmute" : "Mute"}
            </button>
          )}
          {state.audioBlocked && (
            <button className="button" onClick={controller.play}>
              Play call audio
            </button>
          )}
          {(call || state.preparing) && (
            <button
              className="button lc-call-end"
              onClick={() => void controller.end()}
            >
              {ringing
                ? "Decline"
                : call?.status === "ringing" || state.preparing
                  ? "Cancel"
                  : "Hang up"}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
export function Calls({ calling }: { calling: Calling }) {
  const { state, user } = calling;
  const reviewedThrough = Math.max(0, ...state.calls.map(c => c.endedAt ?? 0));
  useEffect(() => {
    const review = () => { if (state.ready && reviewedThrough && document.visibilityState === 'visible') void calling.controller.review(reviewedThrough).catch(() => {}); };
    review(); document.addEventListener('visibilitychange', review);
    return () => document.removeEventListener('visibilitychange', review);
  }, [calling.controller, state.ready, reviewedThrough]);
  function duration(c: AudioCall) {
    if (!c.acceptedAt || !c.endedAt) return "—";
    const seconds = Math.floor((c.endedAt - c.acceptedAt) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return (
    <div className="split">
      <section className="center">
        <h1>Calls</h1>
        <p className="sub">Your call history, recordings, and voicemails.</p>
        <label className="workspace-page-search">
          <span>Search</span>
          <input
            type="search"
            aria-label="Search Calls"
            placeholder="Search calls…"
            disabled
          />
        </label>
        <div className="tools">
          <div className="tabs">
            {["All", "Missed", "Voicemail", "Recordings", "Active"].map(
              (label, i) => (
                <button
                  key={label}
                  className={i === 0 ? "active" : ""}
                  disabled
                  title="Not available yet"
                >
                  {label}
                  <span>—</span>
                </button>
              ),
            )}
          </div>
          <div className="smalltools">
            <label className="button">
              <Icon name="calendar" />
              <select aria-label="Call date range" disabled>
                <option>All dates</option>
                <option>Last 30 days</option>
                <option>Last 7 days</option>
                <option>Today</option>
              </select>
            </label>
            <button
              className="icon"
              onClick={() => void calling.controller.sync()}
              aria-label="Refresh calls"
            >
              <Icon name="filter" />
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Contact",
                  "Direction",
                  "Details",
                  "Date & time",
                  "Duration",
                  "Status",
                ].map((label, i) => (
                  <th key={label} className={i === 2 ? "extra-col" : ""}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.calls.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.caller.id === user ? c.callee.name : c.caller.name}
                  </td>
                  <td>{c.caller.id === user ? "Outgoing" : "Incoming"}</td>
                  <td className="extra-col">Audio call</td>
                  <td>
                    {new Date(c.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{duration(c)}</td>
                  <td>
                    {c.reason ??
                      (c.status === "active"
                        ? "In progress"
                        : c.status === "ringing"
                          ? "Ringing"
                          : "Connecting")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!state.calls.length && (
            <div className="empty" role="status">
              {state.ready
                ? "Your call history will appear here."
                : "Connecting to the calling service…"}
            </div>
          )}
        </div>
      </section>
      <aside className="details">
        <div className="section-head">
          <h2>Call Details</h2>
          <button className="icon" disabled aria-label="Call options">
            <Icon name="more" />
          </button>
        </div>
        <p className="sub">Select a call to view its details.</p>
      </aside>
    </div>
  );
}
