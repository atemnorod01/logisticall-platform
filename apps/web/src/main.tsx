import { useEffect, useState, useSyncExternalStore } from "react";
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
import { Icon } from "./ui.js";
import { usePresence, type PresenceMode } from "./presence.js";
import { Contacts } from "./contacts-view.js";
import { Calls, Conversations } from "./communication-views.js";
import {
  OrganizationGroups,
  GroupInboxes,
  NetworkGroups,
} from "./groups-view.js";
type Page =
  | "Conversations"
  | "Calls"
  | "Contacts"
  | "Settings"
  | "Organization administration"
  | "Group inboxes"
  | "Network directory";
const controller = workspaceController();
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
  const presence = usePresence(
    state.context?.organization_id,
    state.session?.csrfToken,
    state.session?.userId,
  );
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("atem.workspace.theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  const [page, setPage] = useState<Page>("Settings");
  useEffect(() => {
    void controller.load();
  }, []);
  useEffect(() => {
    const root = document.getElementById("app")!;
    root.className =
      state.phase === "ready"
        ? `tenant-ui conversation-workspace${page !== "Conversations" ? " workspace-pages" : ""}`
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
        <div className="brand">LogistiCall</div>
        <h1>Your workspace.</h1>
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
                disabled={!state.context}
                title={label}
                onClick={() =>
                  setPage(label as "Conversations" | "Calls" | "Contacts")
                }
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
              <span className="avatar tone-0">
                ?
                <span
                  className="presence-dot"
                  data-presence={presence.status}
                  role="img"
                  aria-label={`Your presence: ${presence.status}`}
                />
              </span>
            </summary>
            <div className="account-popover">
              <label
                className="user-status-label"
                htmlFor="user-presence-choice"
              >
                Your status
              </label>
              <select
                id="user-presence-choice"
                aria-label="Your status"
                value={presence.mode}
                disabled={!state.context}
                onChange={(e) =>
                  presence.setMode(e.target.value as PresenceMode)
                }
              >
                <option value="auto">Automatic</option>
                <option value="available">Available</option>
                <option value="away">Away</option>
                <option value="busy">Busy</option>
              </select>
              <small role="status">
                {state.context
                  ? `Presence: ${presence.status}`
                  : "Choose an organization to share presence"}
              </small>
              {state.context && (
                <>
                  <button
                    className="button"
                    onClick={() => setPage("Group inboxes")}
                  >
                    Group inboxes
                  </button>
                  <button
                    className="button"
                    onClick={() => setPage("Network directory")}
                  >
                    Network directory
                  </button>
                  {state.permissions.includes("groups.manage") && (
                    <button
                      className="button"
                      onClick={() => setPage("Organization administration")}
                    >
                      Organization administration
                    </button>
                  )}
                </>
              )}
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
                    <button
                      className="button"
                      onClick={() => setPage("Organization administration")}
                    >
                      Organization administration
                    </button>
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
        ) : page === "Organization administration" ? (
          state.permissions.includes("groups.manage") ? (
            <OrganizationGroups
              key={state.context.organization_id}
              organizationId={state.context.organization_id}
              organizationName={state.context.name}
              csrf={state.session!.csrfToken}
            />
          ) : (
            <section className="admin">
              <h1>Access unavailable</h1>
              <p>Organization administrator access is required.</p>
            </section>
          )
        ) : page === "Group inboxes" ? (
          <GroupInboxes
            key={`${state.session!.userId}:${state.context.organization_id}`}
            organizationId={state.context.organization_id}
            organizationName={state.context.name}
            csrf={state.session!.csrfToken}
          />
        ) : page === "Network directory" ? (
          <NetworkGroups
            key={state.context.organization_id}
            organizationId={state.context.organization_id}
            organizationName={state.context.name}
            csrf={state.session!.csrfToken}
          />
        ) : page === "Contacts" ? (
          <Contacts
            key={`${state.session!.userId}:${state.context.organization_id}`}
            userId={state.session!.userId}
            organization={state.context}
            onCalls={() => setPage("Calls")}
          />
        ) : page === "Calls" ? (
          <Calls />
        ) : (
          <Conversations />
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("app")!).render(<App />);
