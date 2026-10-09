import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Icon } from "./ui.js";
import {
  directoryPage,
  type DirectoryContact,
} from "../../../packages/types/src/index.js";
import type { WorkspaceState } from "./workspace.js";
import type { PresenceMode } from "./presence.js";
export type SettingPage =
  | "Profile"
  | "Notifications"
  | "Audio & video"
  | "Appearance"
  | "Overview"
  | "Members"
  | "Groups";
export const organizationSetting = (page: SettingPage) =>
  ["Overview", "Members", "Groups"].includes(page);
export function AccountMenu({
  state,
  selector,
  presence,
  onSettings,
  onLogout,
}: {
  state: WorkspaceState;
  selector: ReactNode;
  presence: {
    mode: PresenceMode;
    status: string;
    setMode: (mode: PresenceMode) => void;
  };
  onSettings: (page: SettingPage) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const focus = (e: FocusEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("focusin", focus);
    };
  }, [open]);
  useEffect(() => setOpen(false), [state.context?.organization_id]);
  const name = state.session?.displayName?.trim() || "";
  return (
    <div className="lc-account" ref={ref}>
      <button
        ref={trigger}
        className="lc-avatar-trigger"
        aria-label={`Account: ${name || "Your account"}`}
        aria-expanded={open}
        aria-controls="lc-account-panel"
        onClick={() => setOpen(!open)}
      >
        <Avatar name={name} presence={presence.status} />
      </button>
      {open && (
        <div id="lc-account-panel" className="lc-account-panel">
          <div className="lc-account-identity">
            <Avatar name={name} />
            <div>
              <strong>{name || "Your account"}</strong>
              <small>Personal account</small>
            </div>
          </div>
          <div className="lc-account-org">
            <span className="lc-caption">Current organization</span>
            {state.context &&
            state.organizations.length === 1 &&
            state.nextOffset === null ? (
              <strong>{state.context.name}</strong>
            ) : (
              selector
            )}
            {state.switching && <p role="status">Switching organization…</p>}
          </div>
          <div className="lc-account-links">
            <label htmlFor="account-status">Your status</label>
            <select
              id="account-status"
              value={presence.mode}
              disabled={!state.context}
              onChange={(e) => presence.setMode(e.target.value as PresenceMode)}
            >
              <option value="auto">Automatic</option>
              <option value="available">Available</option>
              <option value="away">Away</option>
              <option value="busy">Busy</option>
            </select>
            <small>Presence: {presence.status}</small>
            <button
              onClick={() => {
                setOpen(false);
                onSettings("Profile");
              }}
            >
              <Icon name="users" />
              My profile
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onSettings("Notifications");
              }}
            >
              <Icon name="settings" />
              Notification preferences
            </button>
          </div>
          <button
            className="lc-signout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
export function SettingsNav({
  page,
  setPage,
  admin,
  organization,
}: {
  page: SettingPage;
  setPage: (p: SettingPage) => void;
  admin: boolean;
  organization?: string | undefined;
}) {
  return (
    <aside className="lc-settings-nav" aria-label="Settings navigation">
      <h2>Settings</h2>
      <span className="lc-caption">Personal</span>
      {(
        [
          "Profile",
          "Notifications",
          "Audio & video",
          "Appearance",
        ] as SettingPage[]
      ).map((p) => (
        <button
          key={p}
          className={page === p ? "selected" : ""}
          aria-current={page === p ? "page" : undefined}
          onClick={() => setPage(p)}
        >
          <Icon
            name={
              p === "Profile"
                ? "users"
                : p === "Appearance"
                  ? "sun"
                  : p === "Audio & video"
                    ? "phone"
                    : "settings"
            }
          />
          {p}
        </button>
      ))}
      {admin && (
        <>
          <span className="lc-caption lc-org-caption">Organization</span>
          <strong className="lc-org-name">{organization}</strong>
          {(["Overview", "Members", "Groups"] as SettingPage[]).map((p) => (
            <button
              key={p}
              className={page === p ? "selected" : ""}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              <Icon
                name={
                  p === "Groups"
                    ? "message"
                    : p === "Members"
                      ? "users"
                      : "settings"
                }
              />
              {p}
            </button>
          ))}
        </>
      )}
    </aside>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="lc-modal"
      aria-labelledby="lc-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2 id="lc-modal-title">{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function PersonalSettings({
  page,
  state,
  selector,
  theme,
  setTheme,
}: {
  page: SettingPage;
  state: WorkspaceState;
  selector: ReactNode;
  theme: string;
  setTheme: (t: string) => void;
}) {
  const [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem(
          `logisticall.notifications.${state.session?.userId}`,
        ) || "{}",
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (page !== "Audio & video") return;
    let live = true;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        if (live) setDevices(d);
      })
      .catch(() => {
        if (live)
          setNotice("Device information is unavailable in this browser.");
      });
    return () => {
      live = false;
    };
  }, [page]);
  return (
    <section className="lc-settings-page">
      <header className="lc-page-heading">
        <div>
          <span className="lc-caption">Personal settings</span>
          <h1>{page}</h1>
        </div>
      </header>
      {state.error && <p role="alert">{state.error}</p>}
      {page === "Profile" ? (
        <>
          <div className="lc-profile-identity">
            <Avatar name={state.session?.displayName || ""} large />
            <div>
              <h2>{state.session?.displayName || "Your account"}</h2>
              <p>Your identity is managed by LogistiCall IAM.</p>
            </div>
          </div>
          <div className="lc-form">
            <h3>Workspace</h3>
            {selector}
            {state.switching && (
              <p role="status">Checking organization access…</p>
            )}
            {state.context && <p>Organization role: {state.context.role_id}</p>}
            {!state.organizations.length && (
              <p>No organizations assigned. Contact your administrator.</p>
            )}
          </div>
        </>
      ) : page === "Appearance" ? (
        <div className="lc-form">
          <h3>Theme</h3>
          <p>Choose the appearance for this browser.</p>
          <div className="lc-theme-options">
            {["light", "dark"].map((t) => (
              <button
                className={`button ${theme === t ? "primary" : ""}`}
                aria-pressed={theme === t}
                key={t}
                onClick={() => setTheme(t)}
              >
                <Icon name={t === "light" ? "sun" : "moon"} />
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
      ) : page === "Notifications" ? (
        <>
          <p>
            Preferences for this browser. Delivery becomes available when
            messaging and calling are connected.
          </p>
          {["Messages", "Incoming calls", "Mentions"].map((n) => (
            <label key={n} className="lc-setting-row">
              <span>
                <strong>{n}</strong>
              </span>
              <input
                type="checkbox"
                checked={notifications[n] ?? true}
                onChange={(e) => {
                  const next = { ...notifications, [n]: e.target.checked };
                  setNotifications(next);
                  try {
                    localStorage.setItem(
                      `logisticall.notifications.${state.session!.userId}`,
                      JSON.stringify(next),
                    );
                    setNotice("Preference saved on this browser.");
                  } catch {
                    setNotice("This browser could not save the preference.");
                  }
                }}
              />
            </label>
          ))}
        </>
      ) : (
        <div className="lc-form">
          <p>
            Available devices reported by your browser. Calling is not connected
            yet.
          </p>
          {(["audioinput", "audiooutput", "videoinput"] as const).map(
            (kind) => (
              <div className="lc-setting-row" key={kind}>
                <strong>
                  {kind === "audioinput"
                    ? "Microphone"
                    : kind === "audiooutput"
                      ? "Speaker"
                      : "Camera"}
                </strong>
                <span>
                  {devices
                    .filter((d) => d.kind === kind)
                    .map((d) => d.label || "System device")
                    .join(", ") || "System default"}
                </span>
              </div>
            ),
          )}
        </div>
      )}
      {notice && (
        <p className="lc-feedback" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
export function OrganizationOverview({ state }: { state: WorkspaceState }) {
  return (
    <section className="lc-settings-page">
      <header className="lc-page-heading">
        <div>
          <span className="lc-caption">Organization settings</span>
          <h1>Overview</h1>
          <p>Your current organization.</p>
        </div>
      </header>
      <div className="lc-setting-row">
        <strong>Organization name</strong>
        <span>{state.context?.name}</span>
      </div>
      <div className="lc-setting-row">
        <strong>Your role</strong>
        <span>{state.context?.role_id}</span>
      </div>
      <div className="lc-setting-row">
        <strong>Status</strong>
        <span>Active</span>
      </div>
      <p className="lc-feedback">
        Organization identity and access are managed in LogistiCall IAM.
      </p>
    </section>
  );
}
export function OrganizationMembers({
  organizationId,
}: {
  organizationId: string;
}) {
  const [rows, setRows] = useState<DirectoryContact[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [next, setNext] = useState<number | null>(null),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError("");
    fetch(
      `/v1/organizations/${encodeURIComponent(organizationId)}/contacts?limit=50&offset=${offset}&search=${encodeURIComponent(query)}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
      },
    )
      .then(async (r) => {
        if (!r.ok) throw Error();
        const data = directoryPage.parse(await r.json());
        if (data.organization_id !== organizationId) throw Error();
        if (!abort.signal.aborted) {
          setRows((old) =>
            offset ? [...old, ...data.contacts] : data.contacts,
          );
          setNext(data.nextOffset);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setRows([]);
          setNext(null);
          setError("Members could not be loaded. Try searching again.");
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [organizationId, offset, query]);
  return (
    <section className="lc-settings-page">
      <header className="lc-page-heading">
        <div>
          <span className="lc-caption">Organization settings</span>
          <h1>Members</h1>
          <p>Active members of your organization.</p>
        </div>
      </header>
      <form
        className="lc-search"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setRows([]);
          setQuery(search.trim());
        }}
      >
        <input
          aria-label="Search members"
          placeholder="Search name or email"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="button">Search</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Loading members…</p>}
      {rows.map((p) => (
        <div className="lc-member-row" key={p.id}>
          <Avatar name={p.name} presence={p.presence} />
          <div>
            <strong>{p.name}</strong>
            <small>{p.email}</small>
          </div>
        </div>
      ))}
      {!busy && !error && !rows.length && <p>No members match your search.</p>}
      {next !== null && (
        <button
          className="button"
          disabled={busy}
          onClick={() => setOffset(next)}
        >
          Load more members
        </button>
      )}
    </section>
  );
}
