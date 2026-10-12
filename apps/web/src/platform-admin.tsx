import { usePlatformUserPresence } from "./platform-user-presence.js";
import { useCompanyPresence } from './company-presence.js';
import { PlatformAddUser } from "./platform-add-user.js";
import { useEffect, useState, useRef } from "react";
import {
  platformPage,
  platformCreate,
  platformResult,
  type PlatformRow,
  type PlatformSection,
} from "../../../packages/types/src/platform-admin.js";
import { PlatformEditor } from "./platform-editor.js";
import { Avatar, Icon, SettingsHeader } from "./ui.js";
import { invitationLink } from "../../../packages/types/src/settings.js";
export type PlatformAdminPage =
  PlatformSection | "phones" | "jambonz" | "devices";
const tabs: {
  id: PlatformAdminPage;
  label: string;
  icon: string;
  group: string;
  description: string;
}[] = [
  {
    id: "organizations",
    label: "Organizations",
    icon: "building",
    group: "Management",
    description: "Manage organizations on LogistiCall.",
  },
  {
    id: "users",
    label: "Users",
    icon: "users",
    group: "Management",
    description: "People and their organization memberships.",
  },
  {
    id: "directory",
    label: "Industry directory",
    icon: "inbox",
    group: "Management",
    description: "Companies across the freight industry.",
  },
  {
    id: "phones",
    label: "Phone numbers",
    icon: "phone",
    group: "Communications",
    description: "Vendor inventory and organization assignments.",
  },
  {
    id: "jambonz",
    label: "Jambonz",
    icon: "headphones",
    group: "Communications",
    description: "Calling infrastructure and account configuration.",
  },
  {
    id: "devices",
    label: "Devices & sessions",
    icon: "devices",
    group: "Security",
    description: "Devices and signed-in sessions across the platform.",
  },
  {
    id: "audit",
    label: "Audit history",
    icon: "history",
    group: "Security",
    description: "Administrative changes across LogistiCall.",
  },
];
export function PlatformAdminNavigation({
  page,
  onPage,
}: {
  page: PlatformAdminPage;
  onPage: (page: PlatformAdminPage) => void;
}) {
  return (
    <aside
      className="lc-settings-nav lc-platform-nav-panel"
      aria-label="Platform administration navigation"
    >
      <h2>Platform administration</h2>
      {["Management", "Communications", "Security"].map((group) => (
        <div className="lc-platform-nav-group" key={group}>
          <span className="lc-caption">{group}</span>
          {tabs
            .filter((tab) => tab.group === group)
            .map((tab) => (
              <button
                key={tab.id}
                className={page === tab.id ? "selected" : ""}
                aria-current={page === tab.id ? "page" : undefined}
                onClick={() => onPage(tab.id)}
              >
                <Icon name={tab.icon} />
                {tab.label}
              </button>
            ))}
        </div>
      ))}
    </aside>
  );
}
export function PlatformAdmin({
  csrf,
  page,
  onPage,
}: {
  csrf: string;
  page: PlatformAdminPage;
  onPage: (page: PlatformAdminPage) => void;
}) {
  const tab = tabs.find((t) => t.id === page)!;
  if (page === "phones" || page === "jambonz" || page === "devices")
    return (
      <section className="admin lc-platform-admin">
        <SettingsHeader title={tab.label} description={tab.description} />
        <div className="lc-platform-unavailable">
          <Icon name={tab.icon} />
          <h2>
            {page === "devices"
              ? "Session inventory is not connected"
              : page === "phones"
                ? "Phone vendor is not connected"
                : "Jambonz is not connected"}
          </h2>
          <p>
            {page === "devices"
              ? "Device and session management is not available yet."
              : "Administration controls will be available after the service integration is connected."}
          </p>
        </div>
      </section>
    );
  return (
    <PlatformAdminData
      key={page}
      csrf={csrf}
      section={page}
      setSection={onPage}
    />
  );
}
function PlatformAdminData({
  csrf,
  section,
  setSection,
}: {
  csrf: string;
  section: PlatformSection;
  setSection: (page: PlatformSection) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<PlatformRow | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [rows, setRows] = useState<PlatformRow[]>([]),
    [next, setNext] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{
      mode: "directory" | "organization";
      company?: PlatformRow;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [setup, setSetup] = useState<{
      url: string;
      expires_at: string | null;
    } | null>(null);
  const userPresence = usePlatformUserPresence(section === 'users' ? rows.map(row => row.id) : []);
  const companyPresence=useCompanyPresence(section==='organizations'?rows.map(r=>r.id):section==='directory'?rows.flatMap(r=>r.organization_id?[r.organization_id]:[]):[]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('logisticall:profile-changed', refresh);
    return () => window.removeEventListener('logisticall:profile-changed', refresh);
  }, []);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    panel.current?.scrollTo(0, 0);
    panel.current
      ?.querySelector(".lc-platform-row.selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [form, editing, section, offset]);
  useEffect(() => {
    if (section !== "directory" || search.trim() === query) return;
    const timer = setTimeout(
      () => {
        setOffset(0);
        setQuery(search.trim());
        setEditing(null);
      },
      search.trim() ? 180 : 0,
    );
    return () => clearTimeout(timer);
  }, [section, search, query]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    fetch(
      `/v1/platform/${section}?${new URLSearchParams({ search: query, offset: String(offset), limit: String(pageSize) })}`,
      { credentials: "same-origin", signal: abort.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw Error(
            response.status === 403
              ? "Platform administrator access is required."
              : "Could not load platform data. Please try again.",
          );
        return platformPage.parse(await response.json());
      })
      .then((page) => {
        if (abort.signal.aborted) return;
        setRows(page.rows);
        setNext(page.nextOffset);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [section, query, offset, pageSize, revision]);
  async function post(path: string, body: unknown) {
    const response = await fetch(`/v1/platform/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw Error(
        response.status === 409
          ? "This company or organization already exists, or the invitation is unavailable. Refresh the list before trying again."
          : response.status === 403
            ? "You do not have permission to perform this action."
            : "The operation could not be completed. You can retry without creating a duplicate.",
      );
    return response.json();
  }
  function open(mode: "directory" | "organization", company?: PlatformRow) {
    setRequestId(crypto.randomUUID());
    setForm({ mode, ...(company ? { company } : {}) });
    setNotice("");
    setError("");
    setSetup(null);
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const input = {
      request_id: requestId,
      mode: form.mode,
      ...(form.company ? { company_id: form.company.id } : {}),
      ...(!form.company
        ? {
            company: {
              name: values.name,
              organization_type: values.organization_type,
              dba: values.dba,
              mc: values.mc,
              dot: values.dot,
              phone: values.phone,
              email: values.email,
              street: values.street,
              city: values.city,
              state: values.state,
              postal_code: values.postal_code,
              country: values.country,
            },
          }
        : {}),
      ...(form.mode === "organization"
        ? { owner_email: values.owner_email, owner_name: values.owner_name }
        : {}),
    };
    const parsed = platformCreate.safeParse(input);
    if (!parsed.success) {
      setError(
        "Complete the required company details and enter a valid owner email.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = platformResult.parse(await post("companies", parsed.data));
      setForm(null);
      setSection(result.organization_id ? "organizations" : "directory");
      setOffset(0);
      setSearch("");
      setQuery("");
      setRevision((v) => v + 1);
      setNotice(
        result.organization_id
          ? "Organization created. The owner invitation is ready. Generate a setup link below to share with the owner."
          : "Company added to the industry directory.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function link(id: string) {
    setBusy(true);
    setError("");
    setSetup(null);
    try {
      setSetup(invitationLink.parse(await post(`invitations/${id}/link`, {})));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={panel}
      className={`admin lc-platform-admin${section === "directory" ? " lc-platform-directory" : ""}`}
      aria-label="Platform administration"
    >
      <SettingsHeader
        title={tabs.find((t) => t.id === section)!.label}
        description={tabs.find((t) => t.id === section)!.description}
      />
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          {!form && (
            <button
              className="button"
              onClick={() => setRevision((v) => v + 1)}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {setup && (
        <div className="lc-platform-result">
          <strong>Owner setup link</strong>
          <p>
            {setup.expires_at
              ? "This private setup link expires in 15 minutes."
              : "The owner must sign in to accept the invitation."}
          </p>
          <input
            aria-label="Owner setup link"
            value={setup.url}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            className="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(setup.url)
                .then(() => setNotice("Setup link copied."))
                .catch(() => setError("Select and copy the link manually."))
            }
          >
            Copy link
          </button>
          <button className="button" onClick={() => setSetup(null)}>
            Dismiss
          </button>
        </div>
      )}
      {form ? (
        <form className="lc-platform-form" onSubmit={(e) => void create(e)}>
          <h2>
            {form.mode === "directory"
              ? "Add directory company"
              : form.company
                ? `Create organization · ${form.company.name}`
                : "Create organization"}
          </h2>
          {form.company && (
            <p>
              Create an organization from this directory record and assign its
              owner. Company details can be edited in Organizations after
              creation.
            </p>
          )}
          <div className="lc-platform-fields">
            {[
              ["name", "Company name"],
              ["dba", "DBA (optional)"],
              ["mc", "MC number (optional)"],
              ["dot", "USDOT number (optional)"],
              ["phone", "Public phone"],
              ["email", "Company email"],
              ["street", "Street address"],
              ["city", "City"],
              ["state", "State / province"],
              ["postal_code", "Postal code"],
              ["country", "Country"],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  readOnly={Boolean(form.company)}
                  type={name === "email" ? "email" : "text"}
                  defaultValue={
                    name === "phone"
                      ? (form.company?.phones?.[0] ?? "")
                      : String(
                          form.company?.[name as keyof PlatformRow] ??
                            (name === "country" ? "US" : ""),
                        )
                  }
                  required={
                    !form.company &&
                    !["dba", "mc", "dot", "postal_code"].includes(name!)
                  }
                  maxLength={
                    name === "email" ? 254 : name === "name" ? 120 : 200
                  }
                />
              </label>
            ))}
            <label>
              Business type
              <select
                disabled={Boolean(form.company)}
                name="organization_type"
                defaultValue={form.company?.organization_type ?? "carrier"}
              >
                <option value="carrier">Carrier</option>
                <option value="broker">Broker</option>
                <option value="forwarder">Freight forwarder</option>
                <option value="shipper">Shipper</option>
                <option value="factoring">Factoring</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          {form.mode === "organization" && (
            <fieldset>
              <legend>Organization owner</legend>
              <div className="lc-platform-fields">
                <label>
                  Owner email
                  <input
                    name="owner_email"
                    type="email"
                    required
                    maxLength={254}
                  />
                </label>
                <label>
                  Owner name (optional)
                  <input name="owner_name" maxLength={100} />
                </label>
              </div>
              <p>
                The owner will accept an invitation and complete organization
                setup.
              </p>
            </fieldset>
          )}
          <footer>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError("");
              }}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy
                ? "Creating…"
                : form.mode === "directory"
                  ? "Add to directory"
                  : "Create organization"}
            </button>
          </footer>
        </form>
      ) : (
        <div className={`lc-platform-content${editing ? " is-editing" : ""}`}>
          <div className="lc-platform-list-view">
            <div className="lc-platform-toolbar">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setOffset(0);
                  setQuery(search.trim());
                  setEditing(null);
                }}
              >
                <input
                  aria-label={`Search ${tabs.find((t) => t.id === section)?.label}`}
                  placeholder={`Search ${tabs.find((t) => t.id === section)?.label.toLowerCase()}…`}
                  value={search}
                  maxLength={120}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="button lc-platform-search-submit"
                  aria-label="Search"
                >
                  <Icon name="search" />
                </button>
              </form>
              {section === "organizations" && (
                <button
                  className="button primary lc-platform-add"
                  aria-label="Create organization"
                  title="Create organization"
                  onClick={() => open("organization")}
                >
                  <span aria-hidden="true">+</span>
                  <span className="lc-platform-add-label">
                    {" "}
                    Create organization
                  </span>
                </button>
              )}
            </div>
            <div className="lc-platform-list" aria-busy={loading}>
              <div className="lc-platform-list-heading">
                <span>
                  {section === "organizations"
                    ? "Organization"
                    : section === "users"
                      ? "Person"
                      : section === "directory"
                        ? "Company"
                        : "Event"}
                </span>
                <span>{section === "audit" ? "" : "Status"}</span>
              </div>
              {loading ? (
                <p role="status">Loading…</p>
              ) : rows.length === 0 && !error ? (
                <p>No results found.</p>
              ) : (
                rows.map((row) => (
                  <article
                    key={row.id}
                    className={`lc-platform-row${editing?.id === row.id ? " selected" : ""}${section === "audit" ? " lc-platform-audit-row" : ""}`}
                  >
                    {section !== "audit" && (
                      <Avatar name={row.name || row.email || "Company"} inNetwork={section==='organizations'||section==='directory'&&Boolean(row.organization_id)} presence={section==='organizations'?companyPresence[row.id]??'unknown':section==='directory'&&row.organization_id?companyPresence[row.organization_id]??'unknown':section==='users'?userPresence[row.id]??'unknown':undefined} />
                    )}
                    <div
                      className="lc-platform-row-copy"
                      title={row.name || row.email}
                    >
                      <div className="lc-platform-row-identity">
                        {section === "audit" ? (
                          <strong>{row.name}</strong>
                        ) : (
                          <button
                            className="lc-platform-row-name"
                            onClick={() => {
                              setNotice("");
                              setError("");
                              setEditing(row);
                            }}
                          >
                            {row.name || row.email}
                          </button>
                        )}
                        {row.platform_admin && (
                          <span className="lc-platform-badge">
                            Platform admin
                          </span>
                        )}
                      </div>
                      <small>
                        {section === "users"
                          ? row.email
                          : section === "audit"
                            ? `${row.actor || "System"} · ${row.organization || "Platform"} · ${new Date(row.created_at!).toLocaleString()}`
                            : section === "directory"
                              ? [
                                  row.organization_type,

                                  row.mc && `MC ${row.mc}`,
                                  row.dot && `DOT ${row.dot}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : `${row.organization_type} · ${row.members ?? 0} ${row.members === 1 ? "member" : "members"}`}
                      </small>
                      {row.memberships?.map((m, i) => (
                        <small key={i}>
                          {m.organization} · {m.role} · {m.status}
                        </small>
                      ))}
                    </div>
                    <div className="lc-platform-row-actions">
                      {section !== "audit" && (
                        <button
                          className="button lc-platform-edit"
                          aria-label={`View ${row.name || row.email}`}
                          onClick={() => {
                            setNotice("");
                            setError("");
                            setEditing(row);
                          }}
                        >
                          <span aria-hidden="true">›</span>
                        </button>
                      )}
                      {row.status && (
                        <span className="lc-platform-status">
                          {row.status === "inactive" &&
                          section === "organizations"
                            ? "Awaiting setup"
                            : row.status}
                        </span>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
            <footer className="lc-platform-pagination">
              <label>
                Rows
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setOffset(0);
                    setEditing(null);
                  }}
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                disabled={loading || offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - pageSize));
                  setEditing(null);
                }}
              >
                Previous
              </button>
              <span>Page {Math.floor(offset / pageSize) + 1}</span>
              <button
                className="button"
                disabled={loading || next === null}
                onClick={() => {
                  setOffset(next!);
                  setEditing(null);
                }}
              >
                Next
              </button>
            </footer>
          </div>
          {editing && section !== "audit" && (
            <aside
              className="lc-platform-editor-panel"
              aria-label={
                section === "users" ? "User details" : "Company details"
              }
            >
              <PlatformEditor
                key={editing.id}
                kind={section}
                id={editing.id}
                csrf={csrf}
                onCreateOrganization={
                  section === "directory"
                    ? () => {
                        open("organization", editing);
                        setEditing(null);
                      }
                    : undefined
                }
                organizationAccess={
                  section === "organizations" ? (
                    <>
                      <PlatformAddUser
                        key={editing.id}
                        organizationId={editing.id}
                        organizationName={editing.name}
                        memberCount={editing.members ?? 0}
                        active={editing.status === "active"}
                        csrf={csrf}
                      />
                      {!!editing.invitations?.length && (
                        <section className="lc-platform-profile-section">
                          <header>
                            <h3>Owner invitation</h3>
                          </header>
                          {editing.invitations?.map((inv) => (
                            <div
                              className="lc-platform-owner-invitation"
                              key={inv.id}
                            >
                              <p>{inv.email}</p>
                              <small>
                                {Date.parse(inv.expires_at) < Date.now()
                                  ? "Invitation expired"
                                  : "Awaiting acceptance"}
                              </small>
                              <button
                                type="button"
                                className="button"
                                disabled={
                                  busy ||
                                  Date.parse(inv.expires_at) < Date.now()
                                }
                                onClick={() => void link(inv.id)}
                              >
                                Get setup link
                              </button>
                            </div>
                          ))}
                        </section>
                      )}
                    </>
                  ) : null
                }
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  setRevision((v) => v + 1);
                  setNotice("Changes saved.");
                }}
              />
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
