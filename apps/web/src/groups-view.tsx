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
import { Icon } from "./ui.js";
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
export function OrganizationGroups({
  organizationId,
  organizationName,
  csrf,
}: Props) {
  const api = useGroupRequests(organizationId, csrf);
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
  const [search, setSearch] = useState(""),
    [candidates, setCandidates] = useState<DirectoryContact[]>([]),
    [candidate, setCandidate] = useState("");
  const clear = () => {
    setGroups([]);
    setDetail(null);
    setCandidates([]);
    setCandidate("");
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
    setName(value.group.name);
    setDescription(value.group.description);
    setVisibility(value.group.visibility);
    setArchived(value.group.archived);
    setCandidates([]);
    setCandidate("");
  }
  useEffect(() => {
    void api.run(() => list(), clear);
  }, []);
  const fresh = () => {
    setDetail(null);
    setName("");
    setDescription("");
    setVisibility("private");
    setArchived(false);
    setCreateId(crypto.randomUUID());
    setCandidates([]);
    setCandidate("");
  };
  const reload = () =>
    void api.run(async () => {
      await list();
      if (detail) await select(detail.group.id);
    }, clear);
  return (
    <section className="admin">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{organizationName}</div>
          <h1>Organization administration</h1>
          <p>Manage your organization’s groups and shared inbox membership.</p>
        </div>
        <div className="actions">
          <button className="button" disabled={api.busy} onClick={reload}>
            Refresh
          </button>
          <button
            className="button primary"
            disabled={api.busy}
            onClick={fresh}
          >
            New group
          </button>
        </div>
      </div>
      {api.error && <p role="alert">{api.error}</p>}
      {api.busy && <p role="status">Updating groups…</p>}
      <section className="panel padded">
        <h2>Groups</h2>
        <p>
          Only organization owners and admins can change groups or membership.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Visibility</th>
                <th>Status</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>{g.visibility === "network" ? "Network" : "Private"}</td>
                  <td>{g.archived ? "Archived" : "Active"}</td>
                  <td>
                    <button
                      className="button"
                      disabled={api.busy}
                      onClick={() => void api.run(() => select(g.id), clear)}
                      aria-label={`Manage ${g.name}`}
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!groups.length && !api.busy && !api.error && (
          <p>No groups yet. Create a group such as Dispatch.</p>
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
      </section>
      <section className="panel padded">
        <h2>{detail ? `Edit ${detail.group.name}` : "Create group"}</h2>
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
      </section>
      {detail && (
        <section className="panel padded">
          <h2>Group members</h2>
          <p>
            Assigned users can open this group’s shared inbox. Members cannot
            join or leave themselves. Administration alone does not grant inbox
            access.
          </p>
          <ul>
            {detail.members.map((m) => (
              <li key={m.user_id}>
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
              </li>
            ))}
          </ul>
          {!detail.members.length && <p>No members assigned.</p>}
          {!detail.group.archived && (
            <>
              <form
                className="narrow"
                onSubmit={(e) => {
                  e.preventDefault();
                  void api.run(async () => {
                    const data = directoryPage.parse(
                      await api.request(
                        `contacts?limit=50&search=${encodeURIComponent(search)}`,
                      ),
                    );
                    if (data.organization_id !== organizationId) throw Error();
                    setCandidates(data.contacts);
                    setCandidate("");
                  }, clear);
                }}
              >
                <label htmlFor="group-member-search">
                  Find an active organization member
                </label>
                <input
                  id="group-member-search"
                  maxLength={100}
                  value={search}
                  disabled={api.busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="button" disabled={api.busy}>
                  Find members
                </button>
              </form>
              {candidates.length > 0 && (
                <div className="narrow">
                  <label htmlFor="group-member-choice">
                    Organization member
                  </label>
                  <select
                    id="group-member-choice"
                    value={candidate}
                    disabled={api.busy}
                    onChange={(e) => setCandidate(e.target.value)}
                  >
                    <option value="">Choose a member</option>
                    {candidates
                      .filter(
                        (c) => !detail.members.some((m) => m.user_id === c.id),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.email}
                        </option>
                      ))}
                  </select>
                  <button
                    className="button primary"
                    disabled={
                      api.busy || !candidate || detail.members.length >= 200
                    }
                    onClick={() =>
                      void api.run(async () => {
                        await api.request(
                          `groups/${detail.group.id}/members`,
                          "POST",
                          { user_id: candidate, version: detail.group.version },
                        );
                        await select(detail.group.id);
                        await list();
                      }, clear)
                    }
                  >
                    Add to group
                  </button>
                  <p className="note">
                    Search is limited to 50 matches. Refine the name or email
                    for larger directories.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <section className="panel padded">
        <h2>Shared communication channels</h2>
        <p>
          Groups have a stable identity for in-network messaging and calling.
          Email addresses, PSTN numbers, routing and group presence are not
          connected yet.
        </p>
        <button className="button" disabled>
          Assign email address
        </button>{" "}
        <button className="button" disabled>
          Assign phone number
        </button>
      </section>
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
