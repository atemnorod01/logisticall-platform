import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  groupDetail,
  groupList,
  groupSchema,
  networkGroupList,
  type Group,
} from "../../../packages/types/src/groups.js";
import {
  directoryPage,
  type DirectoryContact,
} from "../../../packages/types/src/index.js";
import { Avatar, Icon } from "./ui.js";
import { addGroupMembers } from "./group-member-add.js";
import { Modal } from "./settings-ui.js";
function useGroupRequests(organizationId: string, csrf: string) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const live = useRef(true),
    pending = useRef(false),
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
      `/v1/organizations/${encodeURIComponent(organizationId)}/${path}`,
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
          AbortSignal.timeout(10000),
        ]),
      },
    );
    if (!response.ok) throw Object.assign(Error(), { status: response.status });
    const result: unknown = await response.json();
    if (!live.current) throw Error();
    return result;
  }
  async function run(work: () => Promise<void>, clear: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      if (live.current) {
        clear();
        const status = (error as { status?: number }).status;
        setError(
          status === 409
            ? "The group changed or that name is already in use. Refresh and try again."
            : status === 401 || status === 403
              ? "Your access has changed. Choose your organization again."
              : "Groups are temporarily unavailable. Refresh to try again.",
        );
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return { request, run, busy, error };
}
type Props = { organizationId: string; organizationName: string; csrf: string };
function GroupEditor({
  creating,
  close,
  children,
}: {
  creating: boolean;
  close: () => void;
  children: React.ReactNode;
}) {
  return creating ? (
    <Modal title="New group" onClose={close}>
      {children}
    </Modal>
  ) : (
    <section className="lc-form">{children}</section>
  );
}
function AddGroupMembers({
  organizationId,
  csrf,
  detail,
  onClose,
}: {
  organizationId: string;
  csrf: string;
  detail: z.infer<typeof groupDetail>;
  onClose: () => void;
}) {
  const api = useGroupRequests(organizationId, csrf);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<DirectoryContact[]>([]);
  const [selected, setSelected] = useState<DirectoryContact[]>([]);
  const [assigned, setAssigned] = useState(
    () => new Set(detail.members.map((m) => m.user_id)),
  );
  const [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0),
    [open, setOpen] = useState(true);
  const locked = useRef(false),
    live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    const timer = setTimeout(
      () => {
        void api
          .request(
            `contacts?limit=50&offset=${offset}&search=${encodeURIComponent(query.trim())}`,
          )
          .then((value) => {
            const data = directoryPage.parse(value);
            if (data.organization_id !== organizationId) throw Error();
            if (active) {
              setRows((old) =>
                offset ? [...old, ...data.contacts] : data.contacts,
              );
              setNext(data.nextOffset);
            }
          })
          .catch(() => {
            if (active) setLoadError("Members could not be loaded. Try again.");
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, offset, retry, organizationId]);
  const options = rows.filter((p) => !assigned.has(p.id));
  const capacity = 200 - assigned.size;
  const close = () => {
    if (!locked.current) onClose();
  };
  async function save() {
    if (locked.current || !selected.length) return;
    locked.current = true;
    setSaving(true);
    setError("");
    let completed = 0;
    try {
      await addGroupMembers(
        api.request,
        detail.group.id,
        selected.map((p) => p.id),
        (id) => {
          completed++;
          if (live.current) {
            setAssigned((old) => new Set([...old, id]));
            setSelected((old) => old.filter((p) => p.id !== id));
          }
        },
      );
      if (live.current) onClose();
    } catch {
      if (live.current)
        setError(
          completed
            ? `${completed} added. The remaining people could not be added. Retry or cancel to review the group.`
            : "Members could not be added. Your access or the group may have changed. Retry or cancel to review the group.",
        );
    } finally {
      locked.current = false;
      if (live.current) setSaving(false);
    }
  }
  return (
    <Modal title="Add members" onClose={close}>
      <div className="lc-member-picker">
        <p>
          Select people from your organization to add to {detail.group.name}.
        </p>
        <label htmlFor="group-member-search">Organization members</label>
        <div className="lc-picker-search">
          <input
            id="group-member-search"
            autoFocus
            placeholder="Search name or email"
            value={query}
            maxLength={100}
            disabled={saving}
            aria-expanded={open}
            aria-controls="group-member-options"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
              setRows([]);
              setNext(null);
              setOpen(true);
            }}
          />
          <button
            type="button"
            aria-label={open ? "Collapse member list" : "Expand member list"}
            aria-expanded={open}
            disabled={saving}
            onClick={() => setOpen(!open)}
          >
            {open ? "▴" : "▾"}
          </button>
        </div>
        {open && (
          <div
            id="group-member-options"
            className="lc-picker-options"
            role="group"
            aria-label="Organization members"
          >
            {options.map((p) => {
              const checked = selected.some((s) => s.id === p.id);
              return (
                <label className="lc-picker-option" key={p.id}>
                  <Avatar name={p.name} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.email}</small>
                  </span>
                  <input
                    type="checkbox"
                    aria-label={p.name}
                    checked={checked}
                    disabled={
                      saving || (!checked && selected.length >= capacity)
                    }
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, p]
                          : old.filter((s) => s.id !== p.id),
                      )
                    }
                  />
                </label>
              );
            })}
            {loading && <p role="status">Loading members…</p>}
            {loadError && (
              <div role="alert">
                <p>{loadError}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Try again
                </button>
              </div>
            )}
            {!loading && !loadError && !options.length && (
              <p>
                {query
                  ? "No matching members available."
                  : "No unassigned members on this page."}
              </p>
            )}
            {next !== null && !loadError && (
              <button
                type="button"
                className="button"
                disabled={loading || saving}
                onClick={() => setOffset(next)}
              >
                Load more members
              </button>
            )}
          </div>
        )}
        {selected.length > 0 && (
          <div className="lc-picker-selected" aria-label="Selected members">
            {selected.map((p) => (
              <button
                type="button"
                key={p.id}
                disabled={saving}
                aria-label={`Deselect ${p.name}`}
                onClick={() =>
                  setSelected((old) => old.filter((s) => s.id !== p.id))
                }
              >
                {p.name} ×
              </button>
            ))}
          </div>
        )}
        {capacity <= selected.length && (
          <p role="status">Group limit: 200 members.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="lc-picker-actions">
          <button
            type="button"
            className="button"
            disabled={saving}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={saving || !selected.length}
            onClick={() => void save()}
          >
            {saving ? "Adding…" : `Add selected (${selected.length})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function OrganizationGroups({
  organizationId,
  organizationName,
  csrf,
}: Props) {
  const api = useGroupRequests(organizationId, csrf);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false),
    [tab, setTab] = useState<"Members" | "Settings">("Members"),
    [showArchived, setShowArchived] = useState(false),
    [groupSearch, setGroupSearch] = useState("");
  const [groups, setGroups] = useState<Group[]>([]),
    [next, setNext] = useState<number | null>(null);
  const [detail, setDetail] = useState<z.infer<typeof groupDetail> | null>(
    null,
  );
  const [createId, setCreateId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [visibility, setVisibility] = useState<"private" | "network">("private"),
    [archived, setArchived] = useState(false);
  const clear = () => {
    setGroups([]);
    setDetail(null);
    setNext(null);
  };
  async function list(offset = 0) {
    const data = groupList.parse(await api.request(`groups?offset=${offset}`));
    setGroups((old) => (offset ? [...old, ...data.groups] : data.groups));
    setNext(data.nextOffset);
  }
  async function select(id: string) {
    const value = groupDetail.parse(await api.request(`groups/${id}`));
    setDetail(value);
    setCreating(false);
    setAdding(false);
    setName(value.group.name);
    setDescription(value.group.description);
    setVisibility(value.group.visibility);
    setArchived(value.group.archived);
  }
  useEffect(() => {
    void api.run(() => list(), clear);
  }, []);
  const fresh = () => {
    setCreating(true);
    setDetail(null);
    setName("");
    setDescription("");
    setVisibility("private");
    setArchived(false);
    setCreateId(crypto.randomUUID());
  };
  const reload = () =>
    void api.run(async () => {
      await list();
      if (detail) await select(detail.group.id);
    }, clear);
  return (
    <section className="admin lc-group-admin">
      {detail && (
        <button
          className="lc-group-back"
          disabled={api.busy}
          onClick={() => {
            setDetail(null);
            setTab("Members");
          }}
        >
          ← All groups
        </button>
      )}
      <header className="lc-page-heading">
        <div>
          <span className="lc-caption">{organizationName} / Groups</span>
          <h1>{detail ? detail.group.name : "Groups"}</h1>
          <p>
            {detail
              ? `${detail.members.length} ${detail.members.length === 1 ? "member" : "members"} · ${detail.group.archived ? "Archived" : detail.group.visibility === "network" ? "Network visible" : "Private"}`
              : "Shared inboxes managed by your organization."}
          </p>
        </div>
        <div className="actions">
          <button className="button" disabled={api.busy} onClick={reload}>
            Refresh
          </button>
          {!detail && (
            <button
              className="button primary"
              disabled={api.busy}
              onClick={fresh}
            >
              New group
            </button>
          )}
        </div>
      </header>
      {api.error && !creating && <p role="alert">{api.error}</p>}
      {api.busy && <p role="status">Updating groups…</p>}
      {!detail && (
        <>
          <div className="lc-group-toolbar">
            <input
              type="search"
              aria-label="Search groups"
              placeholder="Search loaded groups"
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
          {groups
            .filter(
              (g) =>
                (showArchived || !g.archived) &&
                g.name.toLowerCase().includes(groupSearch.toLowerCase()),
            )
            .map((g) => (
              <button
                key={g.id}
                className="lc-group-row"
                disabled={api.busy}
                onClick={() => {
                  setTab("Members");
                  void api.run(() => select(g.id), clear);
                }}
                aria-label={`Manage ${g.name}`}
              >
                <span className="lc-group-symbol">
                  <Icon name="inbox" />
                </span>
                <span>
                  <strong>{g.name}</strong>
                  <small>
                    {g.member_count === undefined
                      ? "Member count unavailable"
                      : `${g.member_count} ${g.member_count === 1 ? "member" : "members"}`}
                    {g.archived ? " · Archived" : ""}
                  </small>
                </span>
                <em>
                  {g.visibility === "network" ? "Network visible" : "Private"}
                </em>
                <span className="lc-group-chevron">
                  <Icon name="chevron" />
                </span>
              </button>
            ))}
          {!api.busy &&
            !api.error &&
            !groups.some(
              (g) =>
                (showArchived || !g.archived) &&
                g.name.toLowerCase().includes(groupSearch.toLowerCase()),
            ) && (
              <p className="lc-feedback">
                No groups to show. Create a group or include archived groups.
              </p>
            )}
          {next !== null && (
            <button
              className="button"
              disabled={api.busy}
              onClick={() => void api.run(() => list(next), clear)}
            >
              Load more groups
            </button>
          )}
        </>
      )}
      {detail && (
        <div
          className="lc-group-tabs"
          role="tablist"
          aria-label="Group details"
        >
          {(["Members", "Settings"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {(creating || (detail && tab === "Settings")) && (
        <GroupEditor
          creating={creating}
          close={() => {
            if (!api.busy) setCreating(false);
          }}
        >
          {api.error && creating && <p role="alert">{api.error}</p>}
          <form
            className="narrow"
            onSubmit={(e) => {
              e.preventDefault();
              void api.run(async () => {
                const result = z.object({ group: groupSchema }).parse(
                  await api.request(
                    detail ? `groups/${detail.group.id}` : "groups",
                    detail ? "PATCH" : "POST",
                    detail
                      ? {
                          name,
                          description,
                          visibility,
                          archived,
                          version: detail.group.version,
                        }
                      : { id: createId, name, description, visibility },
                  ),
                );
                await list();
                await select(result.group.id);
              }, clear);
            }}
          >
            <label htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              required
              maxLength={80}
              value={name}
              disabled={api.busy}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor="group-description">Description</label>
            <input
              id="group-description"
              maxLength={500}
              value={description}
              disabled={api.busy}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label htmlFor="group-visibility">Discoverability</label>
            <select
              id="group-visibility"
              value={visibility}
              disabled={api.busy}
              onChange={(e) =>
                setVisibility(e.target.value as "private" | "network")
              }
            >
              <option value="private">Private — assigned members only</option>
              <option value="network">
                Discoverable in the LogistiCall network
              </option>
            </select>
            <p className="note">
              Network discovery shares the group name, description and
              organization name with signed-in network participants. It does not
              reveal members or grant inbox access.
            </p>
            {detail && (
              <label htmlFor="group-status">
                Group status
                <select
                  id="group-status"
                  value={archived ? "archived" : "active"}
                  disabled={api.busy}
                  onChange={(e) => setArchived(e.target.value === "archived")}
                >
                  <option value="active">Active</option>
                  <option value="archived">
                    Archived — hide from discovery and close inbox access
                  </option>
                </select>
              </label>
            )}
            <button
              className="button primary"
              disabled={api.busy || !name.trim()}
            >
              {detail ? "Save group" : "Create group"}
            </button>
          </form>
        </GroupEditor>
      )}
      {detail && tab === "Members" && (
        <section className="panel padded">
          <div className="lc-page-heading">
            <h2>Group members</h2>
            {!detail.group.archived && (
              <button
                className="button"
                disabled={api.busy}
                onClick={() => setAdding(true)}
              >
                Add members
              </button>
            )}
          </div>
          <p>
            Assigned users can open this group’s shared inbox. Members cannot
            join or leave themselves. Administration alone does not grant inbox
            access.
          </p>
          <div>
            {detail.members.map((m) => (
              <div className="lc-member-row" key={m.user_id}>
                {m.name}{" "}
                <button
                  className="button"
                  disabled={api.busy || detail.group.archived}
                  aria-label={`Remove ${m.name}`}
                  onClick={() =>
                    void api.run(async () => {
                      await api.request(
                        `groups/${detail.group.id}/members/${m.user_id}`,
                        "DELETE",
                        { version: detail.group.version },
                      );
                      await select(detail.group.id);
                      await list();
                    }, clear)
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {!detail.members.length && <p>No members assigned.</p>}
          {adding && !detail.group.archived && (
            <AddGroupMembers
              organizationId={organizationId}
              csrf={csrf}
              detail={detail}
              onClose={() => {
                setAdding(false);
                reload();
              }}
            />
          )}
        </section>
      )}
    </section>
  );
}
export function GroupInboxes({
  organizationId,
  organizationName,
  csrf,
}: Props) {
  const api = useGroupRequests(organizationId, csrf),
    [groups, setGroups] = useState<Group[]>([]),
    [next, setNext] = useState<number | null>(null),
    [selected, setSelected] = useState<Group | null>(null);
  const clear = () => {
    setGroups([]);
    setSelected(null);
    setNext(null);
  };
  async function list(offset = 0) {
    const value = groupList.parse(
      await api.request(`group-inboxes?offset=${offset}`),
    );
    setGroups((old) => (offset ? [...old, ...value.groups] : value.groups));
    setNext(value.nextOffset);
  }
  async function open(id: string) {
    const result = z
      .object({
        group: groupSchema,
        channels: z.object({
          messaging: z.literal(false),
          calling: z.literal(false),
        }),
      })
      .parse(await api.request(`group-inboxes/${id}`));
    setSelected(result.group);
  }
  useEffect(() => {
    void api.run(() => list(), clear);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void api.run(async () => {
          await list();
          if (selected) await open(selected.id);
        }, clear);
    }, 30000);
    return () => clearInterval(timer);
  }, [selected?.id]);
  return (
    <section className="admin">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{organizationName}</div>
          <h1>Group inboxes</h1>
          <p>
            Shared inboxes assigned to you by your organization administrator.
          </p>
        </div>
        <button
          className="button"
          disabled={api.busy}
          onClick={() =>
            void api.run(async () => {
              await list();
              if (selected) await open(selected.id);
            }, clear)
          }
        >
          Refresh
        </button>
      </div>
      {api.error && <p role="alert">{api.error}</p>}
      {api.busy && <p role="status">Checking group access…</p>}
      <section className="panel padded">
        {groups.map((g) => (
          <button
            key={g.id}
            className="button"
            disabled={api.busy}
            onClick={() => void api.run(() => open(g.id), clear)}
          >
            {g.name}
          </button>
        ))}
        {!groups.length && !api.busy && !api.error && (
          <p>
            No group inboxes assigned. Ask your organization administrator to
            add you.
          </p>
        )}
        {next !== null && (
          <button
            className="button"
            disabled={api.busy}
            onClick={() => void api.run(() => list(next), clear)}
          >
            Load more inboxes
          </button>
        )}
      </section>
      {selected && (
        <section className="panel padded">
          <h2>{selected.name}</h2>
          <p>{selected.description}</p>
          <p>
            You are assigned to this shared inbox. In-network messages and calls
            are not connected yet.
          </p>
          <button className="button" disabled>
            <Icon name="message" />
            New message
          </button>{" "}
          <button className="button" disabled>
            <Icon name="phone" />
            Call as {selected.name}
          </button>
        </section>
      )}
    </section>
  );
}
export function NetworkGroups({
  organizationId,
  organizationName,
  csrf,
}: Props) {
  const api = useGroupRequests(organizationId, csrf),
    [rows, setRows] = useState<z.infer<typeof networkGroupList>["groups"]>([]),
    [next, setNext] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [applied, setApplied] = useState("");
  const clear = () => {
    setRows([]);
    setNext(null);
  };
  async function load(offset = 0, query = search) {
    const result = networkGroupList.parse(
      await api.request(
        `network-groups?offset=${offset}&search=${encodeURIComponent(query)}`,
      ),
    );
    setRows((old) => (offset ? [...old, ...result.groups] : result.groups));
    setNext(result.nextOffset);
    setApplied(query);
  }
  useEffect(() => {
    void api.run(() => load(), clear);
  }, []);
  return (
    <section className="admin">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{organizationName}</div>
          <h1>Network directory</h1>
          <p>
            Discover groups published by organizations in the LogistiCall
            network.
          </p>
        </div>
      </div>
      <form
        className="panel padded"
        onSubmit={(e) => {
          e.preventDefault();
          void api.run(() => load(), clear);
        }}
      >
        <label htmlFor="network-group-search">
          Search organization or group
        </label>
        <input
          id="network-group-search"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={api.busy}
        />
        <button className="button" disabled={api.busy}>
          Search
        </button>
      </form>
      {api.error && <p role="alert">{api.error}</p>}
      {api.busy && <p role="status">Loading network groups…</p>}
      {rows.map((g) => (
        <section key={`${g.organization_id}:${g.id}`} className="panel padded">
          <div className="eyebrow">{g.organization_name}</div>
          <h2>{g.name}</h2>
          <p>{g.description}</p>
          <p>Published group · Member details are private.</p>
          <button
            className="button"
            disabled
            title="In-network messaging is not connected yet"
          >
            <Icon name="message" />
            Message group
          </button>{" "}
          <button
            className="button"
            disabled
            title="In-network calling is not connected yet"
          >
            <Icon name="phone" />
            Call group
          </button>
        </section>
      ))}
      {!rows.length && !api.busy && !api.error && (
        <p>No published groups found.</p>
      )}
      {next !== null && (
        <button
          className="button"
          disabled={api.busy}
          onClick={() => void api.run(() => load(next, applied), clear)}
        >
          Load more groups
        </button>
      )}
      <p className="note">
        Availability will not restrict contacting a group. Messaging and calling
        are not connected yet.
      </p>
    </section>
  );
}
