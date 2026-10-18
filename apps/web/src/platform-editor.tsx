import { TelephonyTabs } from "./telephony-resources.js";
import { OrganizationTelephony } from "./platform-telephony.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { usePlatformUserPresence } from "./platform-user-presence.js";
import { useCompanyPresence } from './company-presence.js';
import { useEffect, useState, type ReactNode } from "react";
import {
  platformRecord,
  platformEdit,
  type PlatformRow,
} from "../../../packages/types/src/platform-admin.js";
import { Avatar } from "./ui.js";

type Field = { key: string; label: string; max?: number; options?: string[][] };
const businessTypes = [
  ["carrier", "Carrier"],
  ["broker", "Broker"],
  ["forwarder", "Freight forwarder"],
  ["shipper", "Shipper"],
  ["factoring", "Factoring"],
  ["other", "Other"],
];
const companySections: { title: string; fields: Field[] }[] = [
  {
    title: "Company",
    fields: [
      { key: "name", label: "Company name", max: 120 },
      { key: "dba", label: "DBA", max: 160 },
      {
        key: "organization_type",
        label: "Business type",
        options: businessTypes,
      },
      { key: "mc", label: "MC number", max: 12 },
      { key: "dot", label: "USDOT number", max: 12 },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "phone", label: "Public phone", max: 40 },
      { key: "email", label: "Company email", max: 254 },
    ],
  },
  {
    title: "Address",
    fields: [
      { key: "street", label: "Street address", max: 200 },
      { key: "city", label: "City", max: 100 },
      { key: "state", label: "State / province", max: 100 },
      { key: "postal_code", label: "Postal code", max: 20 },
      { key: "country", label: "Country", max: 60 },
    ],
  },
];
const userSections: { title: string; fields: Field[] }[] = [
  {
    title: "Profile",
    fields: [{ key: "name", label: "Display name", max: 100 }],
  },
  {
    title: "Account",
    fields: [
      { key: "email", label: "Sign-in email" },
      {
        key: "status",
        label: "Account status",
        options: [
          ["active", "Active"],
          ["suspended", "Suspended"],
        ],
      },
    ],
  },
];
export function PlatformEditor({
  kind,
  id,
  csrf,
  onCreateOrganization,
  organizationAccess,
  onClose,
  onSaved,
}: {
  kind: "organizations" | "directory" | "users";
  id: string;
  csrf: string;
  onCreateOrganization?: (() => void) | undefined;
  organizationAccess?: ReactNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [organizationTab, setOrganizationTab] = useState("info");
  const [telephonyEnabled, setTelephonyEnabled] = useState(false);
  const selectedOrganizationTab = telephonyEnabled || ["info", "members"].includes(organizationTab) ? organizationTab : "info";
  const [telephonySwitchTarget, setTelephonySwitchTarget] = useState<HTMLDivElement | null>(null);
  const [record, setRecord] = useState<
    (PlatformRow & { revision: string }) | null
  >(null);
  const [draft, setDraft] = useState<Record<string, string>>({}),
    [initial, setInitial] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const readOnly = kind === "directory",
    sections = kind === "users" ? userSections : companySections;
  const userPresence = usePlatformUserPresence(kind === 'users' ? [id] : []);
  const companyPresence=useCompanyPresence(kind==='organizations'?[id]:readOnly&&record?.organization_id?[record.organization_id]:[]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const [profileRevision, setProfileRevision] = useState(0);
  useEffect(() => {
    const refresh = () => { if (!dirty && !editing) setProfileRevision(n => n + 1); };
    window.addEventListener('logisticall:profile-changed', refresh);
    return () => window.removeEventListener('logisticall:profile-changed', refresh);
  }, [dirty, editing]);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/v1/platform/records/${kind}/${encodeURIComponent(id)}`, {
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw Error("Could not load this record. Close and try again.");
        return platformRecord.parse(await r.json());
      })
      .then((r) => {
        const values: Record<string, string> = {};
        for (const field of sections.flatMap((s) => s.fields))
          values[field.key] =
            field.key === "phone"
              ? (r.phones?.[0] ?? "")
              : String(
                  r[field.key as keyof PlatformRow] ??
                    (field.key === "status"
                      ? "active"
                      : field.key === "organization_type"
                        ? "other"
                        : ""),
                );
        setRecord(r);
        setDraft(values);
        setInitial(values);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [kind, id, profileRevision]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || readOnly || !dirty) return;
    const input = platformEdit.safeParse(
      kind === "users"
        ? {
            kind: "user",
            revision: record.revision,
            name: draft.name,
            status: draft.status,
          }
        : { kind: "company", revision: record.revision, company: draft },
    );
    if (!input.success) {
      setError("Check the details and enter valid values before saving.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/v1/platform/records/${kind}/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(input.data),
        },
      );
      if (!r.ok)
        throw Error(
          r.status === 409
            ? "This record changed or its company identifiers are already in use. Close and reopen before saving."
            : r.status === 403
              ? "You cannot make this change with your current access."
              : "Could not save changes. Please try again.",
        );
      platformRecord.parse(await r.json());
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={`lc-platform-form lc-platform-editor${readOnly ? " lc-platform-readonly" : ""}`}
      onSubmit={(e) => void save(e)}
    >
      <header className="lc-platform-editor-top">
        <button
          className="button"
          type="button"
          aria-label="Close details"
          onClick={onClose}
          disabled={busy}
        >
          ×
        </button>
      </header>
      <div className="lc-platform-editor-body">
        {record && (
          <div className="lc-platform-profile-heading">
            <Avatar name={draft.name || record.name} inNetwork={kind==='organizations'||readOnly&&Boolean(record.organization_id)} presence={kind==='organizations'?companyPresence[id]??'unknown':readOnly&&record.organization_id?companyPresence[record.organization_id]??'unknown':kind==='users'?userPresence[id]??'unknown':undefined} />
            <div>
              <strong>{draft.name || record.name}</strong>
              {kind !== "users" && (
                <small>
                  {
                    businessTypes.find(
                      (t) => t[0] === draft.organization_type,
                    )?.[1]
                  }
                </small>
              )}
            </div>
          </div>
        )}
        {record && readOnly && !record.organization_id && (
          <div className="lc-platform-company-access">
            {record.organization_id ? (
              null
            ) : (
              <button
                className="button"
                type="button"
                onClick={onCreateOrganization}
              >
                Create organization
              </button>
            )}
          </div>
        )}
        {record && kind === "organizations" && (
          <>
            <TelephonyTabs
              label="Organization"
              items={[
                { key: "info", label: "Info" },
                { key: "members", label: "Members" },
                ...(telephonyEnabled ? [
                  { key: "portaone", label: "PortaOne" },
                  { key: "netsapiens", label: "NetSapiens" },
                  { key: "billing", label: "Billing" },
                ] : []),
              ]}
              value={selectedOrganizationTab}
              onChange={setOrganizationTab}
            />
            <OrganizationTelephony id={id} csrf={csrf} active={record.status === "active"} switchTarget={telephonySwitchTarget} tab={selectedOrganizationTab} onEnabledChange={setTelephonyEnabled} />
            {selectedOrganizationTab === "billing" && (
              <section role="tabpanel" aria-label="Billing">
                <p>Billing information is not available yet.</p>
              </section>
            )}
          </>
        )}
        {record && kind === "organizations" && selectedOrganizationTab === "members" && (
          <div role="tabpanel" aria-label="Members">{organizationAccess}</div>
        )}
        {error && <p role="alert">{error}</p>}
        {!record && !error && <LoadingSkeleton variant="details" rows={4} />}
        <div hidden={kind === "organizations" && selectedOrganizationTab !== "info"} role={kind === "organizations" ? "tabpanel" : undefined} aria-label={kind === "organizations" ? "Info" : undefined}>
        {record &&
          sections.map((section) => (
            <section
              className="lc-platform-profile-section"
              key={section.title}
            >
              <header>
                <h3>{section.title}</h3>
                {!readOnly && (
                  <button
                    type="button"
                    className="lc-platform-section-edit"
                    disabled={busy}
                    onClick={() =>
                      setEditing(
                        editing === section.title ? null : section.title,
                      )
                    }
                  >
                    {editing === section.title ? "Done" : "Edit"}
                  </button>
                )}
              </header>
              {editing === section.title ? (
                <div className="lc-platform-fields">
                  {section.fields.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      {field.options ? (
                        <select
                          value={draft[field.key] ?? ""}
                          disabled={
                            busy ||
                            (field.key === "status" && record.platform_admin)
                          }
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [field.key]: e.target.value,
                            }))
                          }
                        >
                          {field.options.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={draft[field.key] ?? ""}
                          readOnly={kind === "users" && field.key === "email"}
                          disabled={busy}
                          maxLength={field.max}
                          type={field.key === "email" ? "email" : "text"}
                          required={field.key === "name"}
                          pattern={
                            field.key === "mc" || field.key === "dot"
                              ? "[0-9]*"
                              : undefined
                          }
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [field.key]: e.target.value,
                            }))
                          }
                        />
                      )}
                      {kind === "users" && field.key === "email" && (
                        <small>
                          Managed through the account’s verified email flow.
                        </small>
                      )}
                      {field.key === "status" && (
                        <small>
                          {record.platform_admin
                            ? "Platform administrator accounts cannot be suspended here."
                            : "Suspension blocks access across all organizations."}
                        </small>
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <dl>
                  {section.fields.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>
                        {field.options?.find(
                          (o) => o[0] === draft[field.key],
                        )?.[1] ||
                          draft[field.key] ||
                          "Not provided"}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </div>
        {readOnly && record && (
          <p className="lc-platform-source-note">
            Directory information is managed through imports.
          </p>
        )}
      </div>
      {!readOnly && (
        <footer>
          {kind === "organizations" && <div className="lc-platform-telephony-footer" ref={setTelephonySwitchTarget} />}
          <button
            className="button"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !record || !dirty}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </footer>
      )}
    </form>
  );
}
