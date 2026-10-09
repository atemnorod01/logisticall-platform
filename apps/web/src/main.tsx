import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { workspaceController } from "./workspace.js";
import "./styles/desktop-auth.css";
import "./styles/style.css";
import "./styles/tenant-workspace.css";
import "./styles/conversation-workspace.css";
import "./styles/user-directory.css";
import light from "./branding/logisticall_wordmark_light.svg";
import dark from "./branding/logisticall_wordmark_dark.svg";
import brand from "./branding/logisticall_icon_centered.svg";
const controller = workspaceController();
const paths: Record<string, ReactNode> = {
  message: (
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
  ),
  phone: (
    <path d="M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />,
  dialpad: (
    <>
      {[5, 11, 17].flatMap((y) =>
        [6, 12, 18].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />
        )),
      )}
    </>
  ),
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Wordmark() {
  return (
    <>
      <img className="brand-light" src={light} alt="LogistiCall" />
      <img className="brand-dark" src={dark} alt="LogistiCall" />
    </>
  );
}
function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("atem.workspace.theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  const [page, setPage] = useState<"Conversations" | "Settings">("Settings");
  useEffect(() => {
    void controller.load();
  }, []);
  useEffect(() => {
    const root = document.getElementById("app")!;
    root.className =
      state.phase === "ready"
        ? `tenant-ui conversation-workspace${page === "Settings" ? " workspace-pages" : ""}`
        : "";
    document.body.dataset.tenantTheme = theme;
    root.style.colorScheme = theme;
    try {
      localStorage.setItem("atem.workspace.theme", theme);
    } catch {
      /* Preference storage is optional. */
    }
  }, [state.phase, theme, page]);
  if (state.phase !== "ready")
    return (
      <main className="auth-panel">
        <div className="brand">ATEM</div>
        <h1>
          Your team.
          <br />
          Your devices.
        </h1>
        {state.phase === "anonymous" ? (
          <>
            <p>Sign in with your LogistiCall account.</p>
            <a className="button primary full" href="/auth/login">
              Sign in
            </a>
            <p className="note">
              Your administrator assigns access to your organization.
            </p>
          </>
        ) : (
          <>
            <p role="status">{state.error ?? "Opening your workspace…"}</p>
            {state.phase === "error" && (
              <button className="button" onClick={() => void controller.load()}>
                Try again
              </button>
            )}
          </>
        )}
      </main>
    );
  const selector = (
    <>
      <label htmlFor="organization">Organization</label>
      <select
        id="organization"
        value={state.context?.organization_id ?? ""}
        disabled={state.switching}
        onChange={(e) => {
          setPage("Settings");
          void controller.select(e.target.value);
        }}
      >
        <option value="" disabled>
          Choose an organization
        </option>
        {state.organizations.map((org) => (
          <option
            key={org.organization_id}
            value={org.organization_id}
            disabled={
              org.organization_status !== "active" ||
              org.membership_status !== "active"
            }
          >
            {org.name}
            {org.organization_status !== "active" ||
            org.membership_status !== "active"
              ? " — access unavailable"
              : ""}
          </option>
        ))}
      </select>
      {state.nextOffset !== null && (
        <button className="button" onClick={() => void controller.more()}>
          Load more organizations
        </button>
      )}
    </>
  );
  return (
    <div className="layout conversation-shell">
      <aside className="sidebar">
        <div className="rail-brand logisticall-logo" aria-label="LogistiCall">
          <span className="brand-full">
            <img className="brand-stacked-icon" src={brand} alt="" />
            <Wordmark />
          </span>
          <span className="brand-short" aria-hidden="true">
            <img src={brand} alt="" />
          </span>
        </div>
        <nav aria-label="Main navigation">
          {[
            ["Conversations", "message"],
            ["Calls", "phone"],
            ["Contacts", "users"],
          ].map(([label, icon]) => (
            <div className="rail-nav-item" key={label}>
              <button
                type="button"
                className={page === label ? "active" : ""}
                aria-label={label}
                aria-current={page === label ? "page" : undefined}
                disabled={label !== "Conversations" || !state.context}
                title={label !== "Conversations" ? "Not connected yet" : label}
                onClick={() => setPage("Conversations")}
              >
                <Icon name={icon!} />
              </button>
              <span>{label}</span>
            </div>
          ))}
        </nav>
        <div className="rail-bottom">
          <button
            className="icon dialpad-connection is-disconnected"
            disabled
            title="Calling is not connected"
            aria-label="Open dial pad — Disconnected"
          >
            <Icon name="dialpad" />
          </button>
          <button
            className="icon"
            aria-label={theme === "dark" ? "Show light mode" : "Show dark mode"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <details className="account-menu">
            <summary aria-label="Account and workspace">
              <span className="avatar tone-0">?</span>
            </summary>
            <div className="account-popover">
              <strong>Your account</strong>
              <small>{state.context?.name ?? "Choose an organization"}</small>
              <button className="button" onClick={() => setPage("Settings")}>
                My profile
              </button>
              <button
                className="button"
                onClick={() => void controller.logout()}
              >
                Sign out
              </button>
            </div>
          </details>
          <button
            className="icon"
            aria-label="Settings"
            onClick={() => setPage("Settings")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </aside>
      <main className="workspace" id="main-content">
        {page === "Settings" || !state.context ? (
          <section className="admin">
            <div className="page-heading">
              <div>
                <h1>My profile</h1>
                <p>Your personal account and workspace.</p>
              </div>
              <div className="actions" />
            </div>
            {state.error && <p role="alert">{state.error}</p>}
            <section className="panel padded">
              <h2>Workspace</h2>
              {selector}
              {state.switching && (
                <p role="status">Checking organization access…</p>
              )}
              {!state.organizations.length && (
                <p>
                  Your account has no organization memberships. Contact your
                  administrator for an invitation.
                </p>
              )}
              {state.context && (
                <>
                  <h3>{state.context.name}</h3>
                  <p>Organization role: {state.context.role_id}</p>
                  {state.permissions.includes(
                    "organization.profile.update",
                  ) && (
                    <p>Organization administration will be available here.</p>
                  )}
                </>
              )}
            </section>
            <section className="panel padded">
              <h2>Appearance</h2>
              <button
                className="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                Use {theme === "dark" ? "light" : "dark"} mode
              </button>
            </section>
          </section>
        ) : (
          <div className="chat-layout contact-closed">
            <section className="inbox">
              <div className="inbox-head">
                <div className="inbox-title">
                  <h1>Conversations</h1>
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
              </div>
              <div className="messages">
                <div className="empty">
                  Your conversations will appear here.
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("app")!).render(<App />);
