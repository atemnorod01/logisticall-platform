import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  managedMember,
  memberEdit,
} from "../../../packages/types/src/settings.js";
import { groupDetail, groupList } from "../../../packages/types/src/groups.js";
import { Avatar } from "./ui.js";
type Member = z.infer<typeof managedMember>;
type Assignment = { id: string; name: string; assigned: boolean };
export function MemberEditor({
  organizationId,
  userId,
  csrf,
  onBack,
  onSaved,
}: {
  organizationId: string;
  userId: string;
  csrf: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [member, setMember] = useState<Member | null>(null),
    [name, setName] = useState(""),
    [role, setRole] = useState<Member["role_id"]>("member"),
    [status, setStatus] = useState<Member["status"]>("active");
  const [tab, setTab] = useState<"details" | "groups">("details"),
    [groups, setGroups] = useState<Assignment[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [groupsReady, setGroupsReady] = useState(false);
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  async function request(path: string, method = "GET", body?: unknown) {
    const r = await fetch(`/v1/organizations/${organizationId}/${path}`, {
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
        abort.current!.signal,
        AbortSignal.timeout(15000),
      ]),
    });
    if (!r.ok) throw Object.assign(Error(), { status: r.status });
    return r.json();
  }
  function accept(m: Member) {
    setMember(m);
    setName(m.name);
    setRole(m.role_id);
    setStatus(m.status);
  }
  async function loadGroups() {
    const result: Assignment[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = groupList.parse(await request(`groups?offset=${offset}`));
      for (const g of page.groups.filter((g) => !g.archived)) {
        const d = groupDetail.parse(await request(`groups/${g.id}`));
        result.push({
          id: g.id,
          name: g.name,
          assigned: d.members.some((m) => m.user_id === userId),
        });
      }
      offset = page.nextOffset;
    }
    setGroups(result);
    setSelected(result.filter((g) => g.assigned).map((g) => g.id));
    setGroupsReady(true);
  }
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    request(`members/${userId}`)
      .then((v) => {
        if (!controller.signal.aborted) accept(managedMember.parse(v));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Member could not be loaded. Go back and try again.");
      });
    return () => controller.abort();
  }, [organizationId, userId]);
  useEffect(() => {
    if (tab !== "groups" || groupsReady) return;
    loadGroups().catch(() => {
      if (!abort.current?.signal.aborted)
        setError(
          "Groups could not be loaded. Return to Details and try again.",
        );
    });
  }, [tab]);
  async function saveDetails() {
    if (!member || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      accept(
        managedMember.parse(
          await request(
            `members/${userId}`,
            "PATCH",
            memberEdit.parse({
              name,
              role_id: role,
              status,
              expected: {
                name: member.name,
                role_id: member.role_id,
                status: member.status,
              },
            }),
          ),
        ),
      );
      setNotice("Changes saved.");
      onSaved();
    } catch (e) {
      setError(
        (e as { status?: number }).status === 409
          ? "This member changed while you were editing. Go back and reopen the member before saving."
          : "Changes could not be saved. Check your access and try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveGroups() {
    if (lock.current || !groupsReady) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const g of groups) {
        const desired = selected.includes(g.id);
        if (desired === g.assigned) continue;
        const d = groupDetail.parse(await request(`groups/${g.id}`));
        if (d.group.archived) throw Error();
        if (d.members.some((m) => m.user_id === userId) !== desired)
          await request(
            `groups/${g.id}/members${desired ? "" : `/${userId}`}`,
            desired ? "POST" : "DELETE",
            {
              version: d.group.version,
              ...(desired ? { user_id: userId } : {}),
            },
          );
        g.assigned = desired;
      }
      setGroups([...groups]);
      setNotice("Group assignments saved.");
    } catch {
      setGroups([...groups]);
      setError(
        "Some assignments could not be saved. Successful changes are retained; retry the remaining changes.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const dirty =
    member &&
    (name.trim() !== member.name ||
      role !== member.role_id ||
      status !== member.status);
  return (
    <aside
      className="lc-member-editor"
      aria-label="Edit member"
      aria-busy={busy}
    >
      <div className="lc-member-editor-heading">
        <h2>Edit member</h2>
        <button
          className="button"
          aria-label="Close member editor"
          disabled={busy}
          onClick={onBack}
        >
          ×
        </button>
      </div>
      <div
        className="lc-group-tabs"
        role="tablist"
        aria-label="Member settings"
      >
        {(["details", "groups"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setTab(t);
              setNotice("");
              setError("");
            }}
          >
            {t === "details" ? "General information" : "Group membership"}
          </button>
        ))}
      </div>
      <div className="lc-member-feedback" aria-live="polite">
        {error ? (
          <p role="alert">{error}</p>
        ) : notice ? (
          <p role="status">{notice}</p>
        ) : null}
      </div>
      {!member && !error && <p role="status">Loading member…</p>}
      {member && tab === "details" && (
        <form
          className="lc-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDetails();
          }}
        >
          <div className="lc-member-row">
            <Avatar name={member.name} />
            <div>
              <strong>{member.name}</strong>
              <small>{member.email}</small>
            </div>
          </div>
          <label>
            Name
            <input
              value={name}
              required
              maxLength={100}
              disabled={busy || !member.can_edit_name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="lc-muted">
            This name is shared across all organizations this user belongs to.
          </p>
          <div>
            <strong>Email / login name</strong>
            <p>{member.email}</p>
            <small>
              Email cannot be changed. A different email requires a new user.
            </small>
          </div>
          <label>
            Organization role
            <select
              value={role}
              disabled={busy || !member.can_edit_role}
              onChange={(e) => setRole(e.target.value as Member["role_id"])}
            >
              {member.role_id === "owner" && (
                <option value="owner">Owner</option>
              )}
              <option value="member">Member</option>
              <option value="admin">Organization admin</option>
            </select>
          </label>
          <label>
            Organization access
            <select
              value={status}
              disabled={busy || !member.can_edit_access}
              onChange={(e) => setStatus(e.target.value as Member["status"])}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
          <p className="lc-muted">
            Suspending access applies only to this organization. Other
            organizations are unaffected.
          </p>
          {!member.can_edit_access && (
            <p>Your role cannot change this member’s access.</p>
          )}
          <div className="lc-member-actions">
            <button
              className="button primary"
              disabled={busy || !dirty || !name.trim()}
            >
              Save changes
            </button>
          </div>
        </form>
      )}
      {member && tab === "groups" && (
        <div className="lc-form">
          <p>Group assignments apply only to this organization.</p>
          {member.status !== "active" && (
            <p>
              Restore organization access before adding this member to groups.
            </p>
          )}
          <input
            aria-label="Search groups"
            placeholder="Search groups"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!groupsReady && !error && <p role="status">Loading groups…</p>}
          {groups
            .filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
            .map((g) => (
              <label className="lc-assignment-row" key={g.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(g.id)}
                  disabled={busy || (!g.assigned && member.status !== "active")}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, g.id]
                        : ids.filter((id) => id !== g.id),
                    )
                  }
                />
                {g.name}
              </label>
            ))}
          {groupsReady && !groups.length && (
            <p>No active groups in this organization.</p>
          )}
          <div className="lc-member-actions">
            <button
              className="button primary"
              disabled={
                busy ||
                !groupsReady ||
                !groups.some((g) => g.assigned !== selected.includes(g.id))
              }
              onClick={() => void saveGroups()}
            >
              Save assignments
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
