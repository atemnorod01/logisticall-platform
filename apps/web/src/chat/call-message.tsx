import type { Message } from "../../../../packages/types/src/messaging.js";
import { Icon } from "../ui.js";
import { AudioPlayer } from "./audio-player.js";
import "../styles/call-messages.css";
export function CallMessage({
  message: m,
  urls,
  onPerson,
}: {
  message: Message;
  urls: Record<string, string>;
  onPerson: () => void;
}) {
  const call = m.callEvent!;
  const callerLabel = call.callerName;
  const role = call.viewerRole ?? (m.own ? "caller" : "callee");
  // Bubble direction follows the selected inbox, including calls by teammates.
  const outgoing = m.outgoing;
  const observer = role === "observer";
  const missed = role === "callee" && call.outcome === "unanswered";
  const title = observer
    ? call.outcome === "completed"
      ? "Voice call"
      : "Unanswered call"
    : missed
      ? "Missed call"
      : outgoing
        ? call.outcome === "unanswered"
          ? "Unanswered call"
          : "Outgoing call"
        : "Incoming call";
  const duration = `${Math.floor(call.durationSeconds / 60)}:${String(call.durationSeconds % 60).padStart(2, "0")}`;
  const reason: Record<string, string> = {
    "No answer": "No answer",
    Declined: "Declined",
    Canceled: "Canceled",
    Busy: "Busy",
    Unavailable: "Unavailable",
    "Connection lost": "Connection lost",
  };
  return (
    <div
      id={`message-${m.id}`}
      tabIndex={-1}
      className={`lc-message-item lc-call-message-row ${outgoing ? "lc-message-own lc-call-message-outgoing" : ""}`}
    >
      <div className="lc-message-heading">
        {observer ? (
          <span className="sender-name">
            {callerLabel}
          </span>
        ) : !outgoing ? (
          <button type="button" className="sender-name" onClick={onPerson}>
            {callerLabel}
          </button>
        ) : call.sourceTeamName ? <span className="sender-name">{callerLabel}</span> : null}
        <time dateTime={m.createdAt}>
          {new Date(m.createdAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </div>
      <article
        className={`lc-call-message ${missed ? "lc-call-message-missed" : ""}`}
        aria-label={`${title} ${outgoing ? call.calleeName : call.callerName}`}
      >
        <span className="lc-call-message-icon">
          <Icon name={missed ? "phoneMissed" : observer ? "phone" : outgoing ? "phoneOutgoing" : "phoneIncoming"} />
        </span>
        <div className="lc-call-message-copy">
          <h3>{title}</h3>
          <span className="lc-call-message-result">
              {call.outcome === "completed"
                ? duration
                : (reason[call.reason] ?? "Not connected")}
          </span>
          {(outgoing || observer) && <p>To {call.calleeName}</p>}
        </div>
        {call.voicemailId &&
          m.attachments
            .filter((f) => f.mime.startsWith("audio/"))
            .map((file) => (
              <div className="lc-call-message-recording" key={file.id}>
                <span>Voicemail</span>
                {urls[file.id] && urls[file.id] !== "#unavailable" ? (
                  <AudioPlayer url={urls[file.id]!} name="Voicemail" />
                ) : (
                  <small>
                    {urls[file.id]
                      ? "Voicemail unavailable"
                      : "Loading voicemail…"}
                  </small>
                )}
              </div>
            ))}
      </article>
    </div>
  );
}
