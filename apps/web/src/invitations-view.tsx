import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { refreshWhileVisible } from "./refresh-visible.js";
import { Modal } from "./settings-ui.js";
import {
  invitationRows,
  invitationLink,
} from "../../../packages/types/src/settings.js";
export function InvitationManager({
  organizationId,
  csrf,
  creating,
  visible,
  onCreated,
  onClose,
}: {
  organizationId: string;
  csrf: string;
  creating: boolean;
  visible: boolean;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<z.infer<typeof invitationRows>>([]),
    [next, setNext] = useState<number | null>(null);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [link, setLink] = useState<z.infer<typeof invitationLink> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [copied, setCopied] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null),
    [linkOpen, setLinkOpen] = useState(false);
  const live = useRef(true),
    lock = useRef(false),
    abort = useRef(new AbortController());
  useEffect(
    () => () => {
      live.current = false;
      abort.current.abort();
    },
    [],
  );
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(
      `/v1/organizations/${organizationId}/invitations${path}`,
      {
        method,
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: {
          "X-CSRF-Token": csrf,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([
          abort.current.signal,
          AbortSignal.timeout(15000),
        ]),
      },
    );
    if (!response.ok) throw Object.assign(Error(), { status: response.status });
    return response.json();
  }
  async function load(offset = 0) {
    const data = z
      .object({
        invitations: invitationRows,
        nextOffset: z.number().nullable(),
      })
      .parse(await request(`?offset=${offset}`));
    if (live.current) {
      setRows((old) =>
        offset ? [...old, ...data.invitations] : data.invitations,
      );
      setNext(data.nextOffset);
    }
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (live.current)
        setError(
          (e as { status?: number }).status === 409
            ? "An invitation already exists, has expired, or was generated recently. Review the list or wait a minute before retrying."
            : "The request could not be completed. Check your access and try again.",
        );
    } finally {
      lock.current = false;
      if (live.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (!visible || creating || linkOpen) return;
    const refresh = () => void run(() => load());
    refresh();
    return refreshWhileVisible(refresh);
  }, [visible, creating, linkOpen, organizationId]);
  useEffect(() => {
    if (creating) {
      setName("");
      setEmail("");
      setCreatedId(null);
      setLink(null);
      setError("");
      setCopied(false);
    }
  }, [creating]);
  const close = () => {
    if (lock.current) return;
    setLink(null);
    setLinkOpen(false);
    onClose();
  };
  async function generate(id: string) {
    const data = invitationLink.parse(await request(`/${id}/link`, "POST", {}));
    if (live.current) {
      setLink(data);
      setCopied(false);
      setLinkOpen(true);
    }
  }
  return (
    <>
      <section
        className="lc-invitations"
        aria-busy={loading || busy}
        id="organization-invitations-panel"
        role="tabpanel"
        aria-labelledby="organization-invitations-tab"
        hidden={!visible}
      >
        <p>
          New users join as members. Invitation links are shared by you; no
          email is sent.
        </p>
        {loading && (
          <p className="sr-only" role="status">
            Loading invitations…
          </p>
        )}
        {error && !creating && !linkOpen && (
          <p role="alert">
            {error}{" "}
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => load())}
            >
              Refresh
            </button>
          </p>
        )}
        {!loading && !rows.length && !error && <p>No pending invitations.</p>}
        {rows.map((row) => (
          <div className="lc-member-row" key={row.id}>
            <div>
              <strong>{row.display_name || row.email}</strong>
              <small>{row.email}</small>
              <small>
                {Date.parse(row.expires_at) > Date.now()
                  ? "Pending"
                  : "Expired"}{" "}
                · Invitation expires{" "}
                {new Date(row.expires_at).toLocaleDateString()}
              </small>
            </div>
            {row.role_id === "member" && (
              <>
                <button
                  className="button"
                  disabled={busy || Date.parse(row.expires_at) <= Date.now()}
                  onClick={() => void run(() => generate(row.id))}
                >
                  Create link
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(`/${row.id}/revoke`, "POST", {});
                      await load();
                    })
                  }
                >
                  Revoke
                </button>
              </>
            )}
          </div>
        ))}
        {next !== null && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(() => load(next))}
          >
            Load more invitations
          </button>
        )}
      </section>
      {(creating || linkOpen) && (
        <Modal title={link ? "Invite link" : "Invite member"} onClose={close}>
          {error && <p role="alert">{error}</p>}
          {link ? (
            <>
              <p>
                {link.requires_sign_in
                  ? "This person already has an account. Share this link so they can sign in and accept the invitation."
                  : "Share this one-time link with the invited person so they can set up their account."}
              </p>
              <label>
                Invite link
                <input
                  readOnly
                  value={link.url}
                  aria-label="Invite link"
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p>
                {link.expires_at
                  ? `Setup link expires ${new Date(link.expires_at).toLocaleString()}.`
                  : "The invitation remains available until its expiry or revocation."}
              </p>
              <div className="lc-picker-actions">
                <button className="button" onClick={close}>
                  Done
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(link.url)
                      .then(() => setCopied(true))
                      .catch(() =>
                        setError(
                          "Copy is unavailable. Select the link and copy it manually.",
                        ),
                      );
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  let id = createdId;
                  if (!id) {
                    id = z.object({ id: z.uuid() }).parse(
                      await request("", "POST", {
                        name: name.trim(),
                        email: email.trim(),
                      }),
                    ).id;
                    if (live.current) {
                      setCreatedId(id);
                      onCreated();
                    }
                  }
                  await load();
                  await generate(id);
                });
              }}
            >
              <p>
                Create an invitation and copy its link. No email will be sent.
              </p>
              <label>
                Name
                <input
                  required
                  maxLength={100}
                  value={name}
                  disabled={busy || !!createdId}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  disabled={busy || !!createdId}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <p>
                The email identifies who can accept. New members are not
                automatically added to groups.
              </p>
              <div className="lc-picker-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={busy || !name.trim() || !email.trim()}
                >
                  {busy
                    ? "Creating…"
                    : createdId
                      ? "Retry link creation"
                      : "Create invite link"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
