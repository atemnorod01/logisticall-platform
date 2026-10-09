import {
  organizationProfile,
  organizationEdit,
  organizationType,
} from "../../../packages/types/src/settings.js";
import { z } from "zod";
import { refreshWhileVisible } from "./refresh-visible.js";
import { InvitationManager } from "./invitations-view.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Icon, SettingsHeader } from "./ui.js";
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
              {state.session?.email && <small>{state.session.email}</small>}
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
  platformAdmin,
}: {
  page: SettingPage;
  setPage: (p: SettingPage) => void;
  admin: boolean;
  organization?: string | undefined;
  platformAdmin: boolean;
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
                ? "user"
                : p === "Appearance"
                  ? "appearance"
                  : p === "Audio & video"
                    ? "headphones"
                    : "bell"
            }
          />
          {p}
        </button>
      ))}
      {admin && (
        <>
          <span className="lc-caption lc-org-caption">Organization</span>
          <strong className="lc-org-name">{organization}</strong>
          <span className="lc-org-role">Organization admin</span>
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
                    ? "inbox"
                    : p === "Members"
                      ? "users"
                      : "building"
                }
              />
              {p}
            </button>
          ))}
        </>
      )}
      {platformAdmin && (
        <div className="lc-platform-nav">
          <span className="lc-caption lc-org-caption">Platform</span>
          <a
            href="https://logisticall-iam-staging.pages.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Platform administration ↗
          </a>
        </div>
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
  onSaveName,
}: {
  page: SettingPage;
  state: WorkspaceState;
  selector: ReactNode;
  theme: string;
  setTheme: (t: string) => void;
  onSaveName: (name: string) => Promise<void>;
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
      <SettingsHeader
        section="Personal settings"
        title={page}
        description={
          {
            Profile: "Manage your name and workspace.",
            Notifications:
              "Choose your notification preferences for this browser.",
            "Audio & video": "Review your microphone, speaker and camera.",
            Appearance: "Choose the appearance for this browser.",
            Overview: "Manage your organization.",
            Members: "People in your organization.",
            Groups: "Shared inboxes managed by your organization.",
          }[page]
        }
      />
      {state.error && <p role="alert">{state.error}</p>}
      {page === "Profile" ? (
        <>
          <div className="lc-profile-identity">
            <Avatar name={state.session?.displayName || ""} large />
            <div>
              <h2>{state.session?.displayName || "Your account"}</h2>
            </div>
          </div>
          <NameEditor
            label="Your name"
            value={state.session?.displayName || ""}
            maxLength={100}
            onSave={onSaveName}
          />
          <div className="lc-form">
            <h3>Workspace</h3>
            {selector}
            {state.switching && (
              <p className="sr-only" role="status">
                Checking organization access…
              </p>
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
export function OrganizationOverview({
  state,
  onSave,
}: {
  state: WorkspaceState;
  onSave: (
    input: z.infer<typeof organizationEdit>,
  ) => Promise<z.infer<typeof organizationProfile>>;
}) {
  const [saved, setSaved] = useState<z.infer<
    typeof organizationProfile
  > | null>(null);
  const [name, setName] = useState(state.context?.name || "");
  const [type, setType] = useState<z.infer<typeof organizationType>>("other");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false),
    live = useRef(true);
  const org = state.context!.organization_id;
  useEffect(() => {
    live.current = true;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/v1/organizations/${org}/profile`, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const value = organizationProfile.parse(await response.json());
        if (value.organization_id !== org) throw Error();
        if (abort.signal.aborted) return;
        setSaved(value);
        setName(value.name);
        setType(value.organization_type);
        setDescription(value.description);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "Organization details could not be loaded. Please try again.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      live.current = false;
      abort.abort();
    };
  }, [org, attempt]);
  const dirty =
    saved &&
    (name.trim() !== saved.name ||
      type !== saved.organization_type ||
      description.trim() !== saved.description);
  return (
    <section
      className="lc-settings-page lc-organization-overview"
      aria-busy={loading || busy}
    >
      <SettingsHeader
        section="Organization settings"
        title="Organization overview"
        description="Your organization’s identity in LogistiCall."
      />
      {loading ? (
        <p className="sr-only" role="status">
          Loading organization details…
        </p>
      ) : !saved ? (
        <div role="alert">
          <p>{error}</p>
          <button className="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <form
          className="lc-organization-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current || !dirty) return;
            lock.current = true;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const value = await onSave({
                name: name.trim(),
                organization_type: type,
                description: description.trim(),
              });
              if (live.current) {
                setSaved(value);
                setName(value.name);
                setType(value.organization_type);
                setDescription(value.description);
                setNotice("Changes saved.");
              }
            } catch {
              if (live.current)
                setError("Your changes could not be saved. Please try again.");
            } finally {
              lock.current = false;
              if (live.current) setBusy(false);
            }
          }}
          onChange={() => setNotice("")}
        >
          <label>
            Organization name
            <input
              required
              maxLength={120}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Organization type
            <select
              value={type}
              disabled={busy}
              onChange={(event) =>
                setType(organizationType.parse(event.target.value))
              }
            >
              <option value="broker">Broker</option>
              <option value="carrier">Carrier</option>
              <option value="shipper">Shipper</option>
              <option value="factoring">Factoring</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Description
            <textarea
              maxLength={1000}
              rows={3}
              value={description}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="lc-organization-actions">
            <span role="status">{notice}</span>
            <button
              className="button primary"
              disabled={busy || !dirty || !name.trim()}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
export function OrganizationMembers({
  organizationId,
  csrf,
}: {
  organizationId: string;
  csrf: string;
}) {
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [rows, setRows] = useState<DirectoryContact[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (tab !== "members" || inviting) return;
    return refreshWhileVisible(() => {
      setOffset(0);
      setRefresh((n) => n + 1);
    });
  }, [tab, inviting]);
  useEffect(() => {
    if (tab !== "members") return;
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
  }, [organizationId, offset, query, refresh, tab]);
  return (
    <section className="lc-settings-page" aria-busy={busy}>
      <SettingsHeader
        section="Organization settings"
        title="Members"
        description="People in your organization."
        actions={
          <button className="button primary" onClick={() => setInviting(true)}>
            Invite member
          </button>
        }
      />
      <div
        className="lc-group-tabs"
        role="tablist"
        aria-label="Organization members"
      >
        {(["members", "invitations"] as const).map((item) => (
          <button
            key={item}
            id={`organization-${item}-tab`}
            role="tab"
            aria-selected={tab === item}
            aria-controls={`organization-${item}-panel`}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "active" : ""}
            onClick={() => {
              setOffset(0);
              setTab(item);
            }}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "members"
                  : event.key === "End"
                    ? "invitations"
                    : item === "members"
                      ? "invitations"
                      : "members";
              setOffset(0);
              setTab(next);
              document.getElementById(`organization-${next}-tab`)?.focus();
            }}
          >
            {item === "members" ? "Members" : "Invitations"}
          </button>
        ))}
      </div>
      <div
        id="organization-members-panel"
        role="tabpanel"
        aria-labelledby="organization-members-tab"
        hidden={tab !== "members"}
      >
        <form
          className="lc-search"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setQuery(search.trim());
            setRefresh((n) => n + 1);
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
        {busy && (
          <p className="sr-only" role="status">
            Loading members…
          </p>
        )}
        {rows.map((p) => (
          <div className="lc-member-row" key={p.id}>
            <Avatar name={p.name} presence={p.presence} />
            <div>
              <strong>{p.name}</strong>
              <small>{p.email}</small>
            </div>
          </div>
        ))}
        {!busy && !error && !rows.length && (
          <p>No members match your search.</p>
        )}
        {next !== null && (
          <button
            className="button"
            disabled={busy}
            onClick={() => setOffset(next)}
          >
            Load more members
          </button>
        )}
      </div>
      <InvitationManager
        organizationId={organizationId}
        csrf={csrf}
        creating={inviting}
        visible={tab === "invitations"}
        onCreated={() => setTab("invitations")}
        onClose={() => setInviting(false)}
      />
    </section>
  );
}

function NameEditor({
  label,
  value,
  maxLength,
  onSave,
}: {
  label: string;
  value: string;
  maxLength: number;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(value),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  useEffect(() => setName(value), [value]);
  return (
    <form
      className="lc-form lc-single-field-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setNotice("");
        try {
          await onSave(name.trim());
          setNotice("Changes saved.");
        } catch {
          setNotice("Changes could not be saved. Please try again.");
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <label>
        {label}
        <input
          value={name}
          required
          maxLength={maxLength}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            setNotice("");
          }}
        />
      </label>
      <button
        className="button primary"
        disabled={busy || !name.trim() || name.trim() === value}
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
      <p className="lc-save-notice" role="status">
        {notice}
      </p>
    </form>
  );
}
