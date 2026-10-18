import { useEffect, useId, useState } from "react";
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
    ? resourceSections[provider].filter((key) => !["auto-attendants", "dial-plan", "attendant-routing"].includes(key))
    : resourceSections[provider];
  const [section, setSection] = useState<string>(visibleSections[0]!);
  const [data, setData] = useState<TelephonyResourceView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const panelId = useId();
  useEffect(() => {
    let current = true;
    setBusy(true);
    setData(null);
    setError("");
    void telephonyRequest(
      `organizations/${id}/telephony/${provider}/${section}`,
      csrf,
    )
      .then((value) => {
        if (current) setData(telephonyResourceView.parse(value));
      })
      .catch((e) => {
        if (current) setError((e as Error).message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [id, csrf, provider, section, revision]);
  const rows =
      data?.rows.filter((row) =>
        Object.values(row)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) ?? [],
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
          label: names[key]!,
        }))}
        value={section}
        label="Provider resource categories"
        onChange={(key) => {
          setSection(key);
          setSearch("");
          setPage(0);
        }}
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
          onClick={() => setRevision((v) => v + 1)}
        >
          Refresh
        </button>
      </div>
      <div
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
                      setSearch(e.target.value);
                      setPage(0);
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
                  <p>
                    {search
                      ? "No matching resources."
                      : "No resources returned for this organization."}
                  </p>
                )}
                <div className="lc-telephony-resource-toolbar">
                  <button
                    type="button"
                    disabled={selectedPage === 0}
                    onClick={() => setPage(selectedPage - 1)}
                  >
                    Previous
                  </button>
                  <small>
                    {rows.length} resources · Page {selectedPage + 1} of {pages}
                  </small>
                  <button
                    type="button"
                    disabled={selectedPage + 1 >= pages}
                    onClick={() => setPage(selectedPage + 1)}
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
