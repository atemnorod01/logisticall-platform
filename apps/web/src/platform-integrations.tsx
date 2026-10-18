import { useEffect, useRef, useState } from "react";
import { SettingsHeader } from "./ui.js";
import { telephonyRequest } from "./platform-telephony.js";
import {
  telephonyIntegrations,
  type TelephonyIntegrations,
} from "../../../packages/types/src/telephony.js";
import "./styles/platform-integrations.css";
type Provider = "portaone" | "netsapiens";
export function PlatformIntegrations({ csrf }: { csrf: string }) {
  const [settings, setSettings] = useState<TelephonyIntegrations | null>(null),
    [provider, setProvider] = useState<Provider>("portaone");
  const [login, setLogin] = useState(""),
    [token, setToken] = useState(""),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState("");
  const drawer = useRef<HTMLDialogElement>(null);
  const refresh = async () =>
    setSettings(
      telephonyIntegrations.parse(
        await telephonyRequest("telephony/integrations", csrf),
      ),
    );
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [csrf]);
  const clearSecrets = () => {
    setToken("");
    setClientSecret("");
    setPassword("");
  };
  const close = () => {
    drawer.current?.close();
    clearSecrets();
  };
  function open(p: Provider) {
    setProvider(p);
    setError("");
    setMessage("");
    clearSecrets();
    setLogin(settings?.portaoneLogin ?? "");
    setClientId(settings?.netsapiensClientId ?? "");
    setUsername(settings?.netsapiensUsername ?? "");
    drawer.current?.showModal();
  }
  async function action(kind: "save" | "test" | "template") {
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      if (kind === "save")
        await telephonyRequest(
          `telephony/integrations/${provider}`,
          csrf,
          "PUT",
          provider === "portaone"
            ? { login, ...(token ? { token } : {}) }
            : {
                clientId,
                ...(clientSecret ? { clientSecret } : {}),
                username,
                password,
              },
        );
      else
        await telephonyRequest(
          kind === "template"
            ? "telephony/template"
            : `telephony/integrations/${provider}/test`,
          csrf,
          "POST",
          {},
        );
      clearSecrets();
      await refresh();
      setMessage(
        kind === "save"
          ? "Authentication settings saved."
          : kind === "test"
            ? "Connection verified."
            : "Customer, dialing-rule, PBX and seven-alias templates captured.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="admin lc-platform-admin">
      <SettingsHeader
        title="Integrations"
        description="Manage your telephony provider connections."
      />
      <div className="lc-integration-list">
        {(["portaone", "netsapiens"] as const).map((p) => (
          <button
            type="button"
            className="lc-integration-tile"
            key={p}
            aria-haspopup="dialog"
            onClick={() => open(p)}
          >
            <span className="lc-integration-logo" aria-hidden="true">
              {p === "portaone" ? "P" : "N"}
            </span>
            <span className="lc-integration-identity">
              <strong>{p === "portaone" ? "PortaOne" : "NetSapiens"}</strong>
              <small>
                {p === "portaone"
                  ? "Customers, billing and IP aliases"
                  : "Domains and auto attendants"}
              </small>
            </span>
            <span className="lc-integration-state">
              {!settings
                ? "Loading…"
                : settings[p]
                  ? "Authentication configured"
                  : "Not configured"}
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      {settings && !settings.available && (
        <p className="lc-integration-notice">
          Telephony storage must be configured on the server before
          authentication settings can be saved.
        </p>
      )}
      {error && !drawer.current?.open && <p role="alert">{error}</p>}
      <dialog
        ref={drawer}
        className="lc-integration-drawer"
        aria-labelledby="lc-integration-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else clearSecrets();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) {
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right) close();
          }
        }}
      >
        <header>
          <div>
            <small>INTEGRATION SETTINGS</small>
            <h2 id="lc-integration-title">
              {provider === "portaone" ? "PortaOne" : "NetSapiens"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close integration settings"
            disabled={!!busy}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="lc-integration-body">
          <form
            id="lc-integration-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("save");
            }}
          >
            <label>
              API URL
              <input
                readOnly
                value={
                  provider === "portaone"
                    ? "https://mybilling.sipresource.com:8442/rest"
                    : "https://pbx.ringlogix.com/ns-api/v2"
                }
              />
            </label>
            {provider === "portaone" ? (
              <>
                <label>
                  API login
                  <input
                    required
                    maxLength={200}
                    autoComplete="off"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                  />
                </label>
                <label>
                  API token
                  <input
                    type="password"
                    autoComplete="new-password"
                    required={
                      !settings?.portaone || login !== settings.portaoneLogin
                    }
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={
                      settings?.portaone
                        ? "Saved — leave blank to keep"
                        : "Enter API token"
                    }
                  />
                </label>
                <p>Use a PortaOne API token for your reseller account.</p>
              </>
            ) : (
              <>
                <label>
                  Client ID
                  <input
                    required
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Client secret
                  <input
                    type="password"
                    autoComplete="new-password"
                    required={
                      !settings?.netsapiens ||
                      clientId !== settings.netsapiensClientId
                    }
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={
                      settings?.netsapiens
                        ? "Saved — leave blank to keep"
                        : "Enter client secret"
                    }
                  />
                </label>
                <label>
                  Username
                  <input
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <p>
                  Sign in with reseller 289507 access. The password is used for
                  sign-in; saved tokens refresh automatically when needed.
                </p>
                {settings?.netsapiensExpiresAt && (
                  <p>
                    Access token expires{" "}
                    {new Date(settings.netsapiensExpiresAt).toLocaleString()}.
                  </p>
                )}
                {settings?.netsapiensError && (
                  <p role="alert">{settings.netsapiensError}</p>
                )}
              </>
            )}
            <small>
              Authentication secrets are encrypted on the server and are never
              returned to this page.
            </small>
          </form>
          <div className="lc-integration-actions">
            <button
              type="button"
              disabled={!!busy || !settings?.[provider]}
              onClick={() => void action("test")}
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            {provider === "portaone" && (
              <>
                <h3>Provisioning template</h3>
                <p>
                  Use the existing reference customer and Hosted PBX settings,
                  including the seven standard IP aliases.
                </p>
                <button
                  type="button"
                  disabled={!!busy || !settings?.portaone}
                  onClick={() => void action("template")}
                >
                  {busy === "template"
                    ? "Capturing…"
                    : settings?.template
                      ? "Refresh template"
                      : "Capture template"}
                </button>
              </>
            )}
          </div>
          <div aria-live="polite">
            {error ? (
              <p role="alert">{error}</p>
            ) : message ? (
              <p>{message}</p>
            ) : null}
          </div>
        </div>
        <footer>
          <button type="button" disabled={!!busy} onClick={close}>
            Close
          </button>
          <button
            type="submit"
            form="lc-integration-form"
            disabled={!!busy || !settings?.available}
          >
            {busy === "save" ? "Saving…" : "Save authentication"}
          </button>
        </footer>
      </dialog>
    </section>
  );
}
