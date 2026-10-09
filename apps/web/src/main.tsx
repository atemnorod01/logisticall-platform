import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { workspaceController } from "./workspace.js";
import "./styles/desktop-auth.css";
import "./styles/style.css";
import "./styles/tenant-workspace.css";
import "./styles/conversation-workspace.css";
import "./styles/user-directory.css";
import "./styles/sign-in.css";
import "./styles/settings.css";
import {
  AccountMenu,
  SettingsNav,
  PersonalSettings,
  OrganizationOverview,
  OrganizationMembers,
  organizationSetting,
  type SettingPage,
} from "./settings-ui.js";
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
      return localStorage.getItem("logisticall.workspace.theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  const [page, setPage] = useState<Page>("Settings");
  const [setting, setSetting] = useState<SettingPage>("Profile");
  const admin = Boolean(
    state.context && state.permissions.includes("groups.manage"),
  );
  const currentSetting =
    organizationSetting(setting) && !admin ? "Profile" : setting;
  const openSettings = (p: SettingPage) => {
    setSetting(p);
    setPage("Settings");
  };
  useEffect(() => {
    void controller.load();
  }, []);
  useEffect(() => {
    const active = state.organizations.filter(
      (o) =>
        o.membership_status === "active" && o.organization_status === "active",
    );
    if (
      state.phase === "ready" &&
      !state.context &&
      !state.switching &&
      !state.error &&
      state.nextOffset === null &&
      active.length === 1
    )
      void controller.select(active[0]!.organization_id);
  }, [state]);
  useEffect(() => {
    const root = document.getElementById("app")!;
    root.className =
      state.phase === "ready"
        ? `tenant-ui conversation-workspace${page !== "Conversations" ? " workspace-pages" : ""}`
        : "logisticall-auth";
    document.body.dataset.tenantTheme = theme;
    root.style.colorScheme = theme;
    try {
      localStorage.setItem("logisticall.workspace.theme", theme);
    } catch {
      /* Preference storage is optional. */
    }
  }, [state.phase, theme, page]);
  if (state.phase !== "ready")
    return (
      <main className="workspace-signin">
        <section
          className="workspace-signin-card"
          aria-labelledby="signin-heading"
        >
          <div className="workspace-signin-brand">
            <img src={brand} alt="" />
            <img src={light} alt="LogistiCall" />
          </div>
          <h1 id="signin-heading">Sign in to LogistiCall</h1>
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
                <button
                  className="button"
                  onClick={() => void controller.load()}
                >
                  Try again
                </button>
              )}
            </>
          )}
        </section>
      </main>
    );
  const selector = (id: string) => (
    <>
      <label htmlFor={id}>Organization</label>
      <select
        id={id}
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
    <div
      className={`layout conversation-shell${page === "Settings" || !state.context ? " lc-settings-open" : ""}`}
    >
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
          <AccountMenu
            state={state}
            selector={selector("account-organization")}
            presence={presence}
            onSettings={openSettings}
            onLogout={() => void controller.logout()}
          />
          <button
            className="icon"
            aria-label="Settings"
            aria-current={page === "Settings" ? "page" : undefined}
            onClick={() => setPage("Settings")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </aside>
      {(page === "Settings" || !state.context) && (
        <SettingsNav
          page={currentSetting}
          setPage={openSettings}
          admin={admin}
          organization={state.context?.name}
        />
      )}
      <main className="workspace" id="main-content">
        {page === "Settings" || !state.context ? (
          currentSetting === "Groups" && admin ? (
            <OrganizationGroups
              key={state.context!.organization_id}
              organizationId={state.context!.organization_id}
              organizationName={state.context!.name}
              csrf={state.session!.csrfToken}
            />
          ) : currentSetting === "Overview" && admin ? (
            <OrganizationOverview state={state} />
          ) : currentSetting === "Members" && admin ? (
            <OrganizationMembers
              key={state.context!.organization_id}
              organizationId={state.context!.organization_id}
            />
          ) : (
            <PersonalSettings
              key={state.session!.userId}
              page={currentSetting}
              state={state}
              selector={selector("profile-organization")}
              theme={theme}
              setTheme={setTheme}
            />
          )
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
