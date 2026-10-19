import {InfiniteScroll,useInfiniteItems} from './infinite-scroll.js';
import {formatMemberPhone} from './member-phone.js';
import {PlatformMemberModal} from './platform-member-modal.js';
import { useState, useEffect, useRef } from "react";
import type { z } from "zod";
import { Avatar } from "./ui.js";
import {
  platformRecord,
  platformMember,
  platformInvite,
  platformInviteResult,
} from "../../../packages/types/src/platform-admin.js";
import {
  invitationLink,
} from "../../../packages/types/src/settings.js";

export function PlatformAddUser({
  organizationId,
  organizationName,
  memberCount,
  active,
  csrf,
}: {
  organizationId: string;
  organizationName: string;
  memberCount: number;
  active: boolean;
  csrf: string;
}) {
  const [editingMember,setEditingMember]=useState<{id:string;anchor:HTMLElement}|null>(null);
  const [members, setMembers] = useState<z.infer<typeof platformMember>[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const [retry, setRetry] = useState(0);
  const loadedOrganization=useRef(organizationId);
  useEffect(() => {
    const abort = new AbortController();
    if(loadedOrganization.current!==organizationId){setMembers(null);loadedOrganization.current=organizationId;}
    setMembersError("");
    fetch(`/v1/platform/records/organizations/${organizationId}`, {signal: abort.signal})
      .then(async response => {
        if (!response.ok) throw Error("Could not load members.");
        const record = platformRecord.parse(await response.json());
        if (!record.member_list) throw Error("Member list is not available yet.");
        if (!abort.signal.aborted) setMembers(record.member_list);
      })
      .catch(error => { if (!abort.signal.aborted) setMembersError(error.message); });
    return () => abort.abort();
  }, [organizationId, retry]);
  const memberList=useInfiniteItems(members??[],organizationId);
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("member");
  const [localOnly, setLocalOnly] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invitation, setInvitation] = useState(""),
    [url, setUrl] = useState(""),
    [copied, setCopied] = useState(false);
  async function request(path: string, body: unknown) {
    const response = await fetch(`/v1/platform/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw Error(
        response.status === 409
          ? "This person is already a member or has a conflicting invitation."
          : response.status === 403
            ? "Platform administrator access is required."
            : "Could not complete this request. Please try again.",
      );
    return response.json();
  }
  async function invite() {
    const parsed = platformInvite.safeParse({ name, email, role });
    if (!parsed.success) {
      setError("Enter a name and valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = platformInviteResult.parse(
        await request(
          `organizations/${organizationId}/invitations`,
          parsed.data,
        ),
      );
      setInvitation(result.id);
      setRetry(value => value + 1);
      setLocalOnly(result.local_only ?? false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function getLink() {
    setBusy(true);
    setError("");
    try {
      const result = invitationLink.parse(
        await request(`invitations/${invitation}/link`, {}),
      );
      setUrl(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lc-platform-profile-section lc-platform-add-user">
      <header>
        <h3>
          Members <small>({members?.length ?? memberCount})</small>
        </h3>
        <button
          type="button"
          className="button"
          disabled={!active || busy}
          onClick={() => {
            setOpen(true);
            setInvitation("");
            setUrl("");
            setError("");
            setName("");
            setEmail("");
            setRole("member");
            setCopied(false);
          }}
        >
          Add user
        </button>
      </header>
      {membersError ? (
        <p role="alert">{membersError} <button type="button" className="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
      ) : members === null ? <p role="status">Loading members…</p> : members.length === 0 ? <p>No members yet.</p> : (
        <><ul className="lc-platform-members" aria-label="Organization members">
          {memberList.items.map(member => (
            <li key={member.id}>
              <Avatar name={member.name || member.email} />
              <div className="lc-platform-member-identity">
                <button type="button" className="lc-platform-member-name" onClick={event=>setEditingMember({id:member.id,anchor:event.currentTarget})}>{member.name || member.email}</button>
                <span>{member.email}</span>
              </div>
              <div className="lc-platform-member-telephony">
                {member.telephony_unavailable ? <small>Phone details unavailable</small> : <>
                  {!!member.extensions?.length && <span className="lc-member-extension">Ext. {member.extensions.join(', ')}</span>}
                  {member.phone_numbers?.map(number => <span className="lc-member-phone" key={number}>{formatMemberPhone(number)}</span>)}
                </>}
              </div>
              <div className="lc-platform-member-role">
                <span>{member.role === "owner" ? "Owner" : member.role === "admin" ? "Organization admin" : "Member"}</span>
                <small>{member.status==='pending'?'Pending':member.status}</small>
              </div>
            </li>
          ))}
        </ul><InfiniteScroll label="Members" hasMore={memberList.hasMore} onMore={memberList.loadMore} progress={memberList.items.length} resetKey={organizationId}/></>
      )}
      {!active && (
        <small>Available after organization setup is complete.</small>
      )}
      {open && (
        <div className="lc-platform-fields">
          {invitation ? (
            <>
              <p role="status">
                Invitation created for {email}. They’re a pending member of {organizationName}.
              </p>
              {localOnly ? (
                <small>
                  Local preview: invitation saved. Account activation links are
                  available in the cloud.
                </small>
              ) : url ? (
                <>
                  <label>
                    Invitation link
                    <input
                      readOnly
                      value={url}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(url)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError("Select and copy the link manually."),
                        )
                    }
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void getLink()}
                >
                  {busy ? "Generating…" : "Get invitation link"}
                </button>
              )}
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <label>
                Name
                <input
                  value={name}
                  maxLength={100}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  value={email}
                  maxLength={254}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Organization role
                <select
                  value={role}
                  disabled={busy}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="member">Member</option>
                  <option value="admin">Organization admin</option>
                </select>
              </label>
              <small>
                Creates an invitation for this organization. No email is sent
                automatically.
              </small>
              <div className="lc-platform-invite-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => void invite()}
                >
                  {busy ? "Creating…" : "Create invitation"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {editingMember&&<PlatformMemberModal id={editingMember.id} anchor={editingMember.anchor} csrf={csrf}
        onClose={()=>setEditingMember(null)} onSaved={()=>{setEditingMember(null);setRetry(value=>value+1);}}/>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
