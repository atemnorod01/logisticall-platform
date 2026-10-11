import { useEffect, useState, useRef } from "react";
import {
  platformPage,
  platformCreate,
  platformResult,
  type PlatformRow,
  type PlatformSection,
} from "../../../packages/types/src/platform-admin.js";
import { Icon } from "./ui.js";
import { invitationLink } from "../../../packages/types/src/settings.js";
export type PlatformAdminPage = PlatformSection | "phones" | "jambonz" | "devices";
const tabs: { id: PlatformAdminPage; label: string; icon: string; group: string; description: string }[] = [
  {id:"organizations",label:"Organizations",icon:"building",group:"Management",description:"Manage organizations on LogistiCall."},
  {id:"users",label:"Users",icon:"users",group:"Management",description:"People and their organization memberships."},
  {id:"directory",label:"Industry directory",icon:"inbox",group:"Management",description:"Companies across the freight industry."},
  {id:"phones",label:"Phone numbers",icon:"phone",group:"Communications",description:"Vendor inventory and organization assignments."},
  {id:"jambonz",label:"Jambonz",icon:"headphones",group:"Communications",description:"Calling infrastructure and account configuration."},
  {id:"devices",label:"Devices & sessions",icon:"devices",group:"Security",description:"Devices and signed-in sessions across the platform."},
  {id:"audit",label:"Audit history",icon:"history",group:"Security",description:"Administrative changes across LogistiCall."},
];
export function PlatformAdminNavigation({page,onPage}:{page:PlatformAdminPage;onPage:(page:PlatformAdminPage)=>void}) {
 return <aside className="lc-settings-nav lc-platform-nav-panel" aria-label="Platform administration navigation">
  <h2>Platform administration</h2>
  {['Management','Communications','Security'].map(group=><div className="lc-platform-nav-group" key={group}>
   <span className="lc-caption">{group}</span>
   {tabs.filter(tab=>tab.group===group).map(tab=><button key={tab.id} className={page===tab.id?'selected':''} aria-current={page===tab.id?'page':undefined} onClick={()=>onPage(tab.id)}><Icon name={tab.icon}/>{tab.label}</button>)}
  </div>)}
 </aside>;
}
export function PlatformAdmin({csrf,page,onPage}:{csrf:string;page:PlatformAdminPage;onPage:(page:PlatformAdminPage)=>void}) {
 const tab=tabs.find(t=>t.id===page)!;
 if(page==='phones'||page==='jambonz'||page==='devices')return <section className="admin lc-platform-admin"><header className="lc-platform-heading"><div><h1>{tab.label}</h1><p>{tab.description}</p></div></header><div className="lc-platform-unavailable"><Icon name={tab.icon}/><h2>{page==='devices'?'Session inventory is not connected':page==='phones'?'Phone vendor is not connected':'Jambonz is not connected'}</h2><p>{page==='devices'?'Device and session management is not available yet.':'Administration controls will be available after the service integration is connected.'}</p></div></section>;
 return <PlatformAdminData key={page} csrf={csrf} section={page} setSection={onPage}/>;
}
function PlatformAdminData({csrf,section,setSection}:{csrf:string;section:PlatformSection;setSection:(page:PlatformSection)=>void}) {
  const panel = useRef<HTMLElement>(null);
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
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    panel.current?.scrollTo(0, 0);
  }, [form, section, offset]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    fetch(
      `/v1/platform/${section}?${new URLSearchParams({ search: query, offset: String(offset) })}`,
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
  }, [section, query, offset, revision]);
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
      className="admin lc-platform-admin"
      aria-label="Platform administration"
    >
      <header className="lc-platform-heading"><div><h1>{tabs.find(t=>t.id===section)!.label}</h1><p>{tabs.find(t=>t.id===section)!.description}</p></div></header>
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
              Use this company’s directory record. Review its details and
              complete any missing contact information.
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
        <>
          <div className="lc-platform-toolbar">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setOffset(0);
                setQuery(search);
              }}
            >
              <input
                aria-label={`Search ${tabs.find((t) => t.id === section)?.label}`}
                placeholder={`Search ${tabs.find((t) => t.id === section)?.label.toLowerCase()}…`}
                value={search}
                maxLength={120}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="button">Search</button>
            </form>
            {section === "organizations" && (
              <button
                className="button primary"
                onClick={() => open("organization")}
              >
                + Create organization
              </button>
            )}
            {section === "directory" && (
              <button
                className="button primary"
                onClick={() => open("directory")}
              >
                + Add company
              </button>
            )}
          </div>
          <div className="lc-platform-list" aria-busy={loading}>
            {loading ? (
              <p role="status">Loading…</p>
            ) : rows.length === 0 && !error ? (
              <p>No results found.</p>
            ) : (
              rows.map((row) => (
                <article key={row.id} className="lc-platform-row">
                  <div>
                    <strong>{row.name || row.email}</strong>
                    <small>
                      {section === "users"
                        ? row.email
                        : section === "audit"
                          ? `${row.actor || "System"} · ${row.organization || "Platform"} · ${new Date(row.created_at!).toLocaleString()}`
                          : section === "directory"
                            ? [
                                row.organization_type,
                                row.city,
                                row.state,
                                row.mc && `MC ${row.mc}`,
                                row.dot && `DOT ${row.dot}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : `${row.organization_type} · ${row.members ?? 0} members`}
                    </small>
                    {row.memberships?.map((m, i) => (
                      <small key={i}>
                        {m.organization} · {m.role} · {m.status}
                      </small>
                    ))}
                    {row.invitations?.map((inv) => (
                      <div className="lc-platform-invitation" key={inv.id}>
                        <small>
                          Owner invitation · {inv.email}
                          {Date.parse(inv.expires_at) < Date.now()
                            ? " · Expired"
                            : ""}
                        </small>
                        <button
                          className="button"
                          disabled={
                            busy || Date.parse(inv.expires_at) < Date.now()
                          }
                          onClick={() => void link(inv.id)}
                        >
                          Get setup link
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="lc-platform-row-actions">
                    {row.status && (
                      <span className="lc-platform-status">
                        {row.status === "inactive" &&
                        section === "organizations"
                          ? "Awaiting setup"
                          : row.status}
                      </span>
                    )}
                    {row.platform_admin && (
                      <span className="lc-platform-badge">Platform admin</span>
                    )}
                    {section === "directory" &&
                      (row.organization_id ? (
                        <span className="lc-platform-badge">
                          Organization linked
                        </span>
                      ) : (
                        <button
                          className="button"
                          onClick={() => open("organization", row)}
                        >
                          Create organization
                        </button>
                      ))}
                  </div>
                </article>
              ))
            )}
          </div>
          <footer className="lc-platform-pagination">
            <button
              className="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </button>
            <span>Page {Math.floor(offset / 50) + 1}</span>
            <button
              className="button"
              disabled={loading || next === null}
              onClick={() => setOffset(next!)}
            >
              Next
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
