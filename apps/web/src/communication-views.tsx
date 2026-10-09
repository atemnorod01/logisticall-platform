import { Icon } from "./ui.js";
export function Calls() {
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
                  title="Calling is not connected"
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
            <button className="icon" disabled aria-label="Refresh calls">
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
            <tbody />
          </table>
          <div className="empty">
            Calling is not connected yet. Your call history will appear here.
          </div>
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
export function Conversations() {
  return (
    <div className="chat-layout contact-closed">
      <section className="inbox">
        <div className="inbox-head">
          <div className="inbox-title">
            <h1>Conversations</h1>
            <div>
              <button
                className="icon"
                disabled
                aria-label="Refresh conversations"
              >
                <Icon name="filter" />
              </button>
              <button className="icon" disabled aria-label="New conversation">
                <Icon name="plus" />
              </button>
            </div>
          </div>
          <div className="inbox-summary">
            <span className="inbox-all">All conversations</span>
            <span>Newest first</span>
          </div>
        </div>
        <div className="empty">Messaging is not connected yet.</div>
      </section>
      <section className="thread">
        <div className="thread-head">
          <h2>Messages</h2>
          <div className="row-actions">
            <button className="icon" disabled aria-label="Call contact">
              <Icon name="phone" />
            </button>
            <button className="icon" disabled aria-label="Conversation options">
              <Icon name="more" />
            </button>
          </div>
        </div>
        <div className="messages">
          <div className="empty">
            <h2>Your conversations will appear here</h2>
            <p className="sub">Messages, files, and team conversations.</p>
          </div>
        </div>
        <form className="composer" onSubmit={(e) => e.preventDefault()}>
          <div className="composer-entry">
            <button
              type="button"
              className="button"
              disabled
              aria-label="Attach files"
            >
              ＋
            </button>
            <div className="composer-textbox">
              <div className="composer-text-entry">
                <div
                  id="conversation-draft"
                  role="textbox"
                  aria-disabled="true"
                  aria-multiline="true"
                  aria-label="Message"
                  data-placeholder="Type a message…"
                  contentEditable={false}
                />
                <button
                  type="button"
                  className="format-toggle"
                  disabled
                  aria-label="Format message"
                >
                  A
                </button>
              </div>
            </div>
            <button
              className="button primary"
              type="submit"
              disabled
              aria-label="Send message"
            >
              <Icon name="send" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
