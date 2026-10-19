import { useEffect, useId, useMemo, useState } from "react";
import { splitNetSapiensUsers } from "./netsapiens-user-groups.js";
import {
  resourceSections,
  telephonyResourceView,
  type TelephonyResourceView,
  type TelephonyProvider,
} from "../../../packages/types/src/telephony-resources.js";
import { telephonyRequest } from "./telephony-api.js";
const names: Record<string, string> = {
  customer: "Customer",
  accounts: "Accounts & aliases",
  "dialing-rule": "Dialing rule",
  domain: "Domain",
  users: "Users",
  "other-resources": "Other Resources",
  devices: "Devices",
  "phone-numbers": "Phone numbers",
  "auto-attendants": "Auto attendants",
  "dial-plan": "Dial plan",
  "attendant-routing": "9999 routing",
};
export function TelephonyTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  label: string;
}) {
  return (
    <div className="lc-telephony-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === item.key}
          tabIndex={value === item.key ? 0 : -1}
          key={item.key}
          onClick={() => onChange(item.key)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % items.length
                : event.key === "ArrowLeft"
                  ? (index + items.length - 1) % items.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              onChange(items[next]!.key);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll("button");
              buttons?.[next]?.focus();
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
function useProviderResource(
  id: string,
  csrf: string,
  provider: TelephonyProvider,
  section: string | null,
  revision: number,
) {
  const key = `${id}/${provider}/${section}/${revision}`;
  const [result, setResult] = useState<{
    key: string;
    data: TelephonyResourceView | null;
    error: string;
    busy: boolean;
  }>({ key: "", data: null, error: "", busy: false });
  useEffect(() => {
    if (!section) return;
    let current = true;
    setResult({ key, data: null, error: "", busy: true });
    void telephonyRequest(`organizations/${id}/telephony/${provider}/${section}`, csrf)
      .then((value) => {
        const data = telephonyResourceView.parse(value);
        if (current) setResult({ key, data, error: "", busy: false });
      })
      .catch((e) => {
        if (current) setResult({ key, data: null, error: (e as Error).message, busy: false });
      });
    return () => { current = false; };
  }, [id, csrf, provider, section, revision, key]);
  return result.key === key ? result : { data: null, error: "", busy: !!section };
}

export function TelephonyResources({
  id,
  csrf,
  provider,
}: {
  id: string;
  csrf: string;
  provider: TelephonyProvider;
}) {
  const visibleSections = provider === "netsapiens"
    ? ["domain", "users", "other-resources", "devices", "phone-numbers"]
    : resourceSections[provider];
  const [section, setSection] = useState<string>(visibleSections[0]!);
  const [revision, setRevision] = useState(0),
    [usersRevision, setUsersRevision] = useState(0),
    [views, setViews] = useState<Record<string, { search: string; page: number }>>({});
  const { search, page } = views[section] ?? { search: "", page: 0 };
  const changeView = (change: Partial<{ search: string; page: number }>) =>
    setViews((previous) => ({ ...previous, [section]: { search, page, ...change } }));
  const isUserList = provider === "netsapiens" && ["users", "other-resources"].includes(section);
  // Both user tabs share one provider snapshot, including their unfiltered counts.
  const userList = useProviderResource(id, csrf, provider, provider === "netsapiens" ? "users" : null, usersRevision);
  const resource = useProviderResource(id, csrf, provider, isUserList ? null : section, revision);
  const { data, error, busy } = isUserList ? userList : resource;
  const groups = useMemo(() => splitNetSapiensUsers(userList.data?.rows ?? []), [userList.data]);
  const categoryRows = isUserList
    ? section === "users" ? groups.users : groups.otherResources
    : data?.rows ?? [];
  const panelId = useId();
  const rows =
      categoryRows.filter((row) =>
        Object.values(row)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    pages = Math.max(1, Math.ceil(rows.length / 20)),
    selectedPage = Math.min(page, pages - 1);
  return (
    <section
      className="lc-telephony-resources"
      aria-label={`${provider === "portaone" ? "PortaOne" : "NetSapiens"} resources`}
    >
      <TelephonyTabs
        items={visibleSections.map((key) => ({
          key,
          label: provider === "netsapiens" && ["users", "other-resources"].includes(key)
            ? `${names[key]} (${userList.data && !userList.data.pending ? (key === "users" ? groups.users.length : groups.otherResources.length) : userList.busy ? "…" : "—"})`
            : names[key]!,
        }))}
        value={section}
        label="Provider resource categories"
        onChange={setSection}
      />
      <div className="lc-telephony-resource-toolbar">
        <small>
          {busy
            ? "Reading provider resources…"
            : data
              ? `Updated ${new Date(data.fetchedAt).toLocaleString()}`
              : "Live data unavailable"}
        </small>
        <button
          type="button"
          disabled={busy}
          onClick={() => isUserList ? setUsersRevision((v) => v + 1) : setRevision((v) => v + 1)}
        >
          Refresh
        </button>
      </div>
      <div
        className={`lc-telephony-resource-panel${data?.columns.length ? " has-resource-table" : ""}`}
        role="tabpanel"
        aria-label={names[section]}
        id={panelId}
        aria-busy={busy}
      >
        {busy && <p role="status">Loading {names[section]?.toLowerCase()}…</p>}
        {error && <p role="alert">{error} Use Refresh to try again.</p>}
        {data?.pending && (
          <p>
            This provider is not linked yet. Check setup progress, then refresh
            after provisioning completes.
          </p>
        )}
        {data && !data.pending && (
          <>
            {data.fields.length > 0 && (
              <dl className="lc-telephony-resource-fields">
                {data.fields.map((field, index) => (
                  <div key={`${field.label}-${index}`}>
                    <dt>{field.label}</dt>
                    <dd>{field.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
            {data.columns.length > 0 && (
              <>
                <label className="lc-telephony-resource-search">
                  Search {names[section]?.toLowerCase()}
                  <input
                    value={search}
                    onChange={(e) => {
                      changeView({ search: e.target.value, page: 0 });
                    }}
                  />
                </label>
                {rows.length ? (
                  <div className="lc-telephony-resource-table">
                    <table>
                      <thead>
                        <tr>
                          {data.columns.map((col) => (
                            <th key={col.key} scope="col">
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows
                          .slice(selectedPage * 20, (selectedPage + 1) * 20)
                          .map((row, index) => (
                            <tr key={index}>
                              {data.columns.map((col) => (
                                <td key={col.key}>{row[col.key] || "—"}</td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="lc-telephony-resource-empty">
                    {search
                      ? "No matching resources."
                      : "No resources returned for this organization."}
                  </p>
                )}
                <div className="lc-telephony-resource-toolbar lc-telephony-resource-pagination" role="group" aria-label={`${names[section]} pagination`}>
                  <button
                    type="button"
                    disabled={selectedPage === 0}
                    onClick={() => changeView({ page: selectedPage - 1 })}
                  >
                    Previous
                  </button>
                  <small>
                    {rows.length} resources · Page {selectedPage + 1} of {pages}
                  </small>
                  <button
                    type="button"
                    disabled={selectedPage + 1 >= pages}
                    onClick={() => changeView({ page: selectedPage + 1 })}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
