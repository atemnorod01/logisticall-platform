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
