import {formatMemberPhone} from './member-phone';
import { AudioVideoSettings } from "./audio-video-settings.js";
import { OrganizationPageHeader } from "./organization-page-header.js";
import { PlatformPagination } from "./platform-pagination.js";
import { InstallApps } from "./install-apps.js";
import { RingtoneSettings } from "./ringtone-settings.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { VoicemailSettingsEditor } from "./voicemail-settings.js";
import { MemberEditor } from "./member-editor.js";
import {
  managedMemberPage,
  managedMember,
} from "../../../packages/types/src/settings.js";
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
  | "Voicemail"
  | "Install Apps"
  | "Profile"
  | "Notifications"
  | "Audio & video"
  | "Appearance"
  | "Overview"
  | "Members"
  | "Teams"
  | "Phone numbers";
export const organizationSetting = (page: SettingPage) =>
  ["Overview", "Members", "Teams", "Phone numbers"].includes(page);
export const organizationSettingsPages=(telephonyEnabled:boolean):SettingPage[]=>
  telephonyEnabled?["Overview","Members","Teams","Phone numbers"]:["Overview","Members","Teams"];
export function AccountMenu({
  state,
  selector,
  presence,
  onSettings,
  onLogout,
  onPlatformAdmin,
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
  onPlatformAdmin: () => void;
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
  telephonyEnabled=false,
  organization,
  platformAdmin,
  onPlatformAdmin,
}: {
  page: SettingPage;
  setPage: (p: SettingPage) => void;
  admin: boolean;
  telephonyEnabled?: boolean;
  organization?: string | undefined;
  platformAdmin: boolean;
  onPlatformAdmin: () => void;
}) {
  return (
    <aside className="lc-settings-nav" aria-label="Settings navigation">
      <h2>Settings</h2>
      <label className="lc-compact-settings-nav">
        Settings
        <select aria-label="Settings page" value={page} onChange={(e) => setPage(e.target.value as SettingPage)}>
          <optgroup label="Personal">
            {(["Profile", "Notifications", "Audio & video", "Voicemail", "Appearance", "Install Apps"] as SettingPage[]).filter(p=>p!=="Install Apps"||!window.logisticallDesktop).map((p) => <option key={p} value={p}>{p}</option>)}
          </optgroup>
          {admin && <optgroup label={organization || "Organization"}>
            {organizationSettingsPages(telephonyEnabled).map((p) => <option key={p} value={p}>{p}</option>)}
          </optgroup>}
        </select>
      </label>
      <span className="lc-caption">Personal</span>
      {(
        [
          "Profile",
          "Notifications",
          "Audio & video",
          "Voicemail",
          "Appearance",
          "Install Apps",
        ] as SettingPage[]
      ).filter(p=>p!=="Install Apps"||!window.logisticallDesktop).map((p) => (
        <button
          key={p}
          className={page === p ? "selected" : ""}
          aria-current={page === p ? "page" : undefined}
          onClick={() => setPage(p)}
        >
          <Icon
            name={
              p === "Install Apps" ? "devices" : p === "Profile"
                ? "user"
                : p === "Voicemail"
                  ? "phone"
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
          {organizationSettingsPages(telephonyEnabled).map((p) => (
            <button
              key={p}
              className={page === p ? "selected" : ""}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              <Icon
                name={
                  p === "Phone numbers" ? "phone" : p === "Teams"
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
          <button onClick={onPlatformAdmin}>Platform administration</button>
        </div>
      )}
    </aside>
  );
}
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: ReactNode;
  className?: string;
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
      className={`lc-modal ${className}`}
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
  fontSize,
  setFontSize,
  onSaveName,
}: {
  page: SettingPage;
  state: WorkspaceState;
  selector: ReactNode;
  theme: string;
  setTheme: (t: string) => void;
  fontSize: "small" | "medium" | "large";
  setFontSize: (size: "small" | "medium" | "large") => void;
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
  return (
    <section className="lc-settings-page">
      <SettingsHeader

        title={page}
        description={
          {
            "Install Apps": "Logisticall on your desktop.",
            Profile: "Manage your name and workspace.",
            Voicemail: "Choose what callers hear when you’re unavailable.",
            Notifications:
              "Choose your notification preferences for this browser.",
            "Audio & video": "Choose the devices LogistiCall uses for your calls.",
            Appearance: "Choose the appearance for this browser.",
            Overview: "Manage your organization.",
            Members: "People in your organization.",
            "Phone numbers": "Your organization’s telephone numbers.",
            Teams: "Public and private teams managed by your organization.",
          }[page]
        }
      />
      {state.error && <p role="alert">{state.error}</p>}
      {page === "Notifications" && <RingtoneSettings user={state.session?.userId || ""} />}
      {page === "Install Apps" ? <InstallApps /> : page === "Voicemail" ? (
        state.context && state.session && <VoicemailSettingsEditor key={`${state.session.userId}:${state.context.organization_id}`} org={state.context.organization_id} csrf={state.session.csrfToken} name={state.session.displayName || ""}/>
      ) : page === "Profile" ? (
        <>
          <div className="lc-profile-identity">
            <Avatar name={state.session?.displayName || ""} large />
            <div>
              <h2>{state.session?.displayName || "Your account"}</h2>
              {state.session?.email && <p className="lc-profile-email">{state.session.email}</p>}
            </div>
          </div>
          {window.logisticallDesktop?.checkForUpdates && <button className="button" onClick={()=>window.logisticallDesktop?.checkForUpdates?.()}>Check for desktop updates</button>}
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
          <h3 className="lc-font-size-heading">Font size</h3>
          <p className="sub">Applies throughout the workspace. Medium is the original size.</p>
          <div className="lc-font-size-options" role="group" aria-label="Font size">
            {(["small", "medium", "large"] as const).map(size => <button key={size} className={`button ${fontSize === size ? "primary" : ""}`} aria-pressed={fontSize === size} onClick={() => setFontSize(size)}>{size[0]!.toUpperCase() + size.slice(1)}</button>)}
          </div>
        </div>
      ) : page === "Notifications" ? (
        <>
          <p>
            Notification preferences for this device.
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
        <AudioVideoSettings />
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

        title="Organization overview"
        description="Your organization’s identity in LogistiCall."
      />
      {loading ? (
        <LoadingSkeleton variant="details" rows={4} />
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
  telephonyEnabled=false,
}: {
  organizationId: string;
  csrf: string;
  telephonyEnabled?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [pageSize, setPageSize] = useState(10);
  const [sort,setSort]=useState<'name'|'extension'|'phone'>('name');
  const [direction,setDirection]=useState<'asc'|'desc'>('asc');
  const [roleFilter,setRoleFilter]=useState('all'),[statusFilter,setStatusFilter]=useState('all');
  useEffect(()=>{if(!telephonyEnabled){setSort('name');setDirection('asc');setOffset(0);}},[telephonyEnabled]);
  function changeSort(key:'name'|'extension'|'phone'){setOffset(0);setDirection(sort===key&&direction==='asc'?'desc':'asc');setSort(key);}
  const [rows, setRows] = useState<z.infer<typeof managedMember>[]>([]),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (tab !== "members" || inviting || editing) return;
    return refreshWhileVisible(() => {
      setRefresh((n) => n + 1);
    });
  }, [tab, inviting, editing]);
  useEffect(() => {
    if (tab !== "members") return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    (async () => {
      const response = await fetch(
      `/v1/organizations/${encodeURIComponent(organizationId)}/members?offset=${offset}&limit=${pageSize}&search=${encodeURIComponent(query)}&sort=${sort}&direction=${direction}&role=${roleFilter}&status=${statusFilter}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
      },
      );
      if (!response.ok) throw Error();
      return managedMemberPage.parse(await response.json());
    })()
      .then((data) => {
        if (!abort.signal.aborted) {
          setRows(data.members);
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
  }, [organizationId, offset, pageSize, query, refresh, tab, sort, direction, roleFilter, statusFilter]);
  return (
    <section className="lc-settings-page lc-members-page" aria-busy={busy}>
      <OrganizationPageHeader
        title="Members"
        description="People in your organization."
        actions={
          <button className="button primary" onClick={() => setInviting(true)}>
            <Icon name="plus" /> Invite member
          </button>
        }
        tabs={<div
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
      </div>}
      />
      <div
        id="organization-members-panel"
        role="tabpanel"
        aria-labelledby="organization-members-tab"
        hidden={tab !== "members"}
      >
        <form
          className="lc-search lc-org-search-toolbar lc-member-toolbar"
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
          <select aria-label="Filter members by role" value={roleFilter} onChange={e=>{setRoleFilter(e.target.value);setOffset(0);}}>
            <option value="all">All roles</option><option value="owner">Owner</option><option value="admin">Organization admin</option><option value="member">Member</option>
          </select>
          <select aria-label="Filter members by status" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setOffset(0);}}>
            <option value="all">All current statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option>
          </select>
        </form>
        {error && <p role="alert">{error}</p>}
        {busy && (
          <p className="sr-only" role="status">
            Loading members…
          </p>
        )}
        <div className={`lc-members-split lc-member-directory ${editing ? "is-editing" : ""}`}>
          <div className="lc-members-list">
            <div className="lc-member-rows">
              <table className={`lc-member-table ${telephonyEnabled?'':'without-telephony'}`}  aria-label="Organization members">
                <colgroup><col className="member-name-col"/>{telephonyEnabled&&<><col className="member-extension-col"/><col className="member-phone-col"/></>}<col className="member-role-col"/><col className="member-status-col"/></colgroup>
                <thead><tr>
                  {([['name','Name'],['extension','Extension'],['phone','Phone number']] as const).filter(([key])=>key==='name'||telephonyEnabled).map(([key,label])=><th key={key} scope="col" aria-sort={sort===key?(direction==='asc'?'ascending':'descending'):'none'}><button type="button" onClick={()=>changeSort(key)}>{label}<span aria-hidden="true">{sort===key?(direction==='asc'?' ↑':' ↓'):' ↕'}</span></button></th>)}
                  <th scope="col">Role</th><th scope="col">Status</th>
                </tr></thead>
                <tbody>{rows.map(p=><tr key={p.user_id} className={editing===p.user_id?'is-selected':''}>
                  <td><div className="lc-member-name-cell"><Avatar name={p.name} presence={p.presence??'unknown'}/><div>
                    <button type="button" className="lc-member-name-link" onClick={()=>setEditing(p.user_id)}>{p.name}</button>
                    <small title={p.email}>{p.email}</small>
                  </div></div></td>
                  {telephonyEnabled&&<><td>{p.extensions?.length?p.extensions.map(ext=><span key={ext} className="lc-member-extension">{ext}</span>):<span className="lc-muted">—</span>}</td>
                  <td>{p.phone_numbers?.length?p.phone_numbers.map(number=><span className="lc-member-phone" key={number}>{formatMemberPhone(number)}</span>):<span className="lc-muted">—</span>}</td>
                  </>}<td>{p.role_id==='owner'?'Owner':p.role_id==='admin'?'Organization admin':'Member'}</td>
                  <td><span className={`lc-member-status is-${p.status}`}>{p.status==='pending'?'Pending':p.status==='active'?'Active':p.status==='archived'?'Archived':'Suspended'}</span></td>
                </tr>)}</tbody>
              </table>
              {busy&&!rows.length&&<LoadingSkeleton/>}
              {!busy&&!error&&!rows.length&&<p className="lc-member-empty">No members match these filters.</p>}
            </div>
            <PlatformPagination
              label="Members"
              page={Math.floor(offset / pageSize)}
              pageSize={pageSize}
              pageSizes={[10, 20, 30, 50]}
              loading={busy}
              onPageSizeChange={size => { setPageSize(size); setOffset(0); }}
              previousDisabled={offset === 0}
              nextDisabled={next === null}
              onPrevious={() => setOffset(Math.max(0, offset - pageSize))}
              onNext={() => { if (next !== null) setOffset(next); }}
            />
          </div>
          {editing && (
            <div className="lc-member-editor-shell">
              <MemberEditor
                key={`${organizationId}:${editing}`}
                organizationId={organizationId}
                userId={editing}
                csrf={csrf}
                onSaved={() => {
                  setRefresh((n) => n + 1);
                }}
                onBack={() => setEditing(null)}
              />
            </div>
          )}
        </div>
      </div>
      <InvitationManager
        organizationId={organizationId}
        telephonyEnabled={telephonyEnabled}
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
