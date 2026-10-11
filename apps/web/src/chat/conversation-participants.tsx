import { useEffect, useState } from "react";
import { z } from "zod";
import {
  addressSchema,
  participantDetailsSchema,
  type Address,
  type ParticipantDetails,
} from "../../../../packages/types/src/messaging.js";
import type { messagingController } from "../messaging.js";
import { Avatar, Icon } from "../ui.js";
export function ConversationParticipants({
  controller,
  organizationId,
  userId,
  onPersonAction,
}: {
  controller: ReturnType<typeof messagingController>;
  organizationId: string;
  userId: string;
  onPersonAction: (person: Address, call: boolean) => void;
}) {
  const [data, setData] = useState<ParticipantDetails | null>(null),
    [stage, setStage] = useState<"list" | "pick" | "review">("list"),
    [category, setCategory] = useState("coworker"),
    [search, setSearch] = useState(""),
    [people, setPeople] = useState<Address[]>([]),
    [chosen, setChosen] = useState<Array<Address & { email?: string }>>([]),
    [history, setHistory] = useState<"all" | "future">("future"),
    [convert, setConvert] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null);
  const [departTarget,setDepartTarget]=useState<string|null>(null);
  const [nextOwner,setNextOwner]=useState("");
  async function depart() {
    if(!departTarget)return;
    setBusy(true);setError("");
    try {await controller.request(controller.path("/participants/depart"),"POST",{targetId:departTarget,...(nextOwner?{nextOwnerId:nextOwner}:{})});setDepartTarget(null);setNextOwner("");await controller.refresh();await reload();}
    catch {setError("Could not update the group. Membership or ownership may have changed. Please try again.");await reload();}
    finally {setBusy(false);}
  }
  function departureConfirmation(targetId:string) {
    if(departTarget!==targetId || !data)return null;
    const leaving=targetId===userId, others=data.participants.filter(p=>p.id!==userId);
    const transfer=leaving && data.ownerId===userId && others.length>0;
    return <div className="lc-depart-confirm" role="group" aria-label={leaving?"Confirm leaving group":"Confirm removal"}>
      <strong>{leaving?"Leave this group?":`Remove ${data.participants.find(p=>p.id===targetId)?.name}?`}</strong>
      <p>{leaving?"You’ll keep earlier history, but won’t receive new messages or calls. You’ll need to be added again to rejoin.":"They’ll keep earlier history, but won’t receive new messages or calls from this group."}</p>
      {transfer&&<label>Choose a new owner<select aria-label="New group owner" value={nextOwner} onChange={e=>setNextOwner(e.target.value)}><option value="">Select a participant</option>{others.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <div><button className="button" disabled={busy} onClick={()=>{setDepartTarget(null);setNextOwner("");}}>{leaving?"Stay":"Cancel"}</button><button className="button lc-danger" disabled={busy||(transfer&&!nextOwner)} onClick={()=>void depart()}>{leaving?(transfer?"Transfer & leave":"Leave group"):"Remove"}</button></div>
    </div>;
  }
  const [saved,setSaved]=useState<string[]>([]);
  const [savedNotice,setSavedNotice]=useState("");
  async function saveContact(person:Address){
    setBusy(true);setError("");
    try{await controller.request(controller.path("/save-contact"),"POST",{id:person.id,organizationId:person.organizationId});setSaved(ids=>[...ids,person.id]);setSavedNotice(`${person.name} is saved in your personal contacts.`);}
    catch{setError("Could not save this person. Please try again.");}
    finally{setBusy(false);}
  }
  const path = controller.path("/participants");
  async function reload() {
    setData(participantDetailsSchema.parse(await controller.request(path)));
  }
  useEffect(() => {
    let live = true;
    const load = () =>
      void controller
        .request(path)
        .then((v) => {
          if (live) setData(participantDetailsSchema.parse(v));
        })
        .catch(() => {
          if (live) setError("Participants could not be loaded.");
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, controller]);
  useEffect(() => {
    if (stage !== "pick") return;
    let live = true;
    setLoading(true);
    setPeople([]);
    setNext(null);
    const timer = setTimeout(() => {
      void controller
        .request(
          `/people?${new URLSearchParams({ search, offset: String(offset) })}`,
        )
        .then((v) => {
          const result = z
            .object({
              people: z.array(addressSchema),
              nextOffset: z.number().nullable(),
            })
            .parse(v);
          if (live) {
            setPeople(
              result.people.filter(
                (p) =>
                  p.kind === "user" &&
                  (category === "coworker"
                    ? p.organizationId === organizationId
                    : p.organizationId !== organizationId),
              ),
            );
            setNext(result.nextOffset);
          }
        })
        .catch(() => {
          if (live) setError("People could not be loaded. Try again.");
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [controller, stage, category, search, offset, organizationId]);
  const externalChoice = chosen.some(
      (p) => p.organizationId !== organizationId,
    ),
    conversion = externalChoice && !data?.external;
  const existing = (p: Address) =>
    data?.participants.some(
      (v) =>
        v.organizationId === p.organizationId &&
        (v.kind === "user"
          ? v.id === p.id
          : v.members.some((m) => m.id === p.id)),
    ) ||
    data?.requests.some(
      (r) =>
        r.target.id === p.id && r.target.organizationId === p.organizationId,
    );
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await controller.request(path, "POST", {
        targets: chosen.map((p) => ({
          id: p.id,
          organizationId: p.organizationId,
          ...(p.email ? { email: p.email } : {}),
        })),
        history,
        convertExternal: convert,
      });
      await reload();
      await controller.refresh();
      setStage("list");
      setChosen([]);
    } catch {
      setError(
        "Could not add these people. They may already be participating, or their access may have changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function decide(requestId: string, approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await controller.request(
        controller.path("/participants/review"),
        "POST",
        { requestId, approve },
      );
      await reload();
      await controller.refresh();
    } catch {
      setError("The request could not be updated. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const changeCategory = (value: string) => {
    setCategory(value);
    setChosen([]);
    setSearch("");
    setOffset(0);
    setError("");
  };
  function actions(person: Address) {
    if(data?.readOnly)return null;
    if (person.id === userId && person.organizationId === organizationId) return null;
    return <div className="lc-person-actions">
      {person.organizationId!==organizationId&&<button className="icon" disabled={busy||saved.includes(person.id)} aria-label={`Save ${person.name} to personal contacts`} title="Save to personal contacts" onClick={()=>void saveContact(person)}>{saved.includes(person.id)?"✓":"＋"}</button>}
      <button className="icon" aria-label={`Message ${person.name} directly`} title="Direct message" onClick={()=>onPersonAction(person,false)}><Icon name="message"/></button>
      <button className="icon" aria-label={`Call ${person.name} directly`} title="Direct call in a separate conversation" onClick={()=>onPersonAction(person,true)}><Icon name="phone"/></button>
    </div>;
  }
  return (
    <section className={`lc-participants ${stage === "pick" ? "lc-participants-picking" : ""}`} aria-label="Participants">
      {savedNotice&&<p role="status">{savedNotice}</p>}
      {stage === "list" ? (
        <>
          <div className="section-head">
            <h3>
              Participants
              {data
                ? ` · ${data.participants.reduce((n, p) => n + (p.kind === "group" ? p.members.length : 1), 0)}`
                : ""}
            </h3>
            <button
              className="button"
              disabled={!data || busy || data.readOnly}
              onClick={() => {
                setStage("pick");
                setChosen([]);
                setError("");
              }}
            >
              ＋ Add people
            </button>
          </div>
          {!data && !error && <p className="sub">Loading participants…</p>}
          {data &&
            [...new Set(data.participants.map((p) => p.organizationId))].map(
              (org) => (
                <div key={org} className="lc-participant-company">
                  {data.external && (
                    <h4>
                      {
                        data.participants.find((p) => p.organizationId === org)
                          ?.organizationName
                      }
                    </h4>
                  )}
                  {data.participants
                    .filter((p) => p.organizationId === org)
                    .map((p) =>
                      p.kind === "group" ? (
                        <details key={p.id} open>
                          <summary>
                            <span className="lc-peer-group-badge">
                              {p.name}
                            </span>
                            <span>{p.members.length} members</span>
                          </summary>
                          {p.members.map((m) => (
                            <div className="lc-participant-person" key={m.id}>
                              <Avatar name={m.name} />
                              <div>
                                <strong>
                                  {m.name}
                                  {m.id === userId ? " (you)" : ""}
                                </strong>
                                <small>Access through {p.name}</small>
                              </div>
                              {actions({...p, kind:"user", id:m.id, name:m.name})}
                            </div>
                          ))}
                        </details>
                      ) : (
                        <div className="lc-participant-person" key={p.id}>
                          <Avatar name={p.name} />
                          <div>
                            <strong>
                              {p.name}
                              {p.id === userId &&
                              p.organizationId === organizationId
                                ? " (you)"
                                : ""}
                            </strong>
                            <small>
                              {p.history === "future"
                                ? "Messages since joining"
                                : "Individual participant"}
                            </small>
                          </div>
                          {actions(p)}
                          {data.internalGroup && data.ownerId===userId && p.id!==userId && !data.readOnly && <details className="lc-member-menu"><summary aria-label={`Manage ${p.name}`}>⋯</summary><button className="button lc-danger" disabled={busy} onClick={e=>{e.currentTarget.closest("details")?.removeAttribute("open");setDepartTarget(p.id);setNextOwner("");}}>Remove from group</button></details>}
                          {data.internalGroup && p.id===data.ownerId && <small className="lc-owner-badge">{data.ownerId===data.creatorId?"Creator":"Owner"}</small>}
                          {p.id!==userId && departureConfirmation(p.id)}
                        </div>
                      ),
                    )}
                </div>
              ),
            )}
          {!!data?.requests.length && (
            <div className="lc-participant-requests">
              <h4>Pending requests</h4>
              {data.requests.map((r) => (
                <div className="lc-participant-request" key={r.id}>
                  <strong>{r.target.name}</strong>
                  <small>{r.target.organizationName}</small>
                  <p>
                    {r.history === "all"
                      ? "Previous public messages included"
                      : "New messages after joining only"}
                  </p>
                  <p className="sub">
                    Requested by {r.requestedBy} · Awaiting{" "}
                    {r.awaiting.join(", ")}
                  </p>
                  {r.canApprove && (
                    <div className="row-actions">
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void decide(r.id, false)}
                      >
                        Decline
                      </button>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void decide(r.id, true)}
                      >
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {data?.internalGroup && !data.readOnly && <div className="lc-group-leave">
            {departTarget===userId?departureConfirmation(userId):<button className="button lc-danger" disabled={busy} onClick={()=>{setDepartTarget(userId);setNextOwner("");}}>Leave group</button>}
          </div>}
          {data?.readOnly && <p className="sub">You are no longer a participant. Earlier messages are available as read-only history.</p>}
          <p className="sub lc-participant-footnote">
            Adding someone gives access to this conversation only.
          </p>
          {!!data?.events.length && (
            <details className="lc-participant-activity">
              <summary>Participant activity</summary>
              {data.events.map((e) => (
                <p key={e.id}>
                  {e.text}
                  <small>{new Date(e.createdAt).toLocaleString()}</small>
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <>
          <div className="section-head">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setStage(stage === "review" ? "pick" : "list");
              }}
            >
              ← Back
            </button>
            <h3>{stage === "review" ? "Confirm access" : "Add people"}</h3>
          </div>
          {stage === "pick" ? (
            <>
              <div className="tabs">
                <button
                  className={category === "coworker" ? "active" : ""}
                  onClick={() => changeCategory("coworker")}
                >
                  Coworkers
                </button>
                <button
                  className={category === "external" ? "active" : ""}
                  onClick={() => changeCategory("external")}
                >
                  External contacts
                </button>
              </div>
              <input
                type="search"
                aria-label="Find participants"
                placeholder={
                  category === "coworker"
                    ? "Search coworkers"
                    : "Exact email of external contact"
                }
                value={search}
                maxLength={254}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                  setError("");
                }}
              />
              <div className="lc-participant-results">
              <div aria-busy={loading}>
                {people.filter(p => !existing(p)).map((p) => (
                  <label
                    className="lc-participant-choice"
                    key={p.organizationId + p.id}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.some(
                        (v) =>
                          v.id === p.id &&
                          v.organizationId === p.organizationId,
                      )}
                      onChange={(e) =>
                        setChosen((old) =>
                          e.target.checked
                            ? [
                                ...old,
                                {
                                  ...p,
                                  ...(category === "external"
                                    ? { email: search.trim() }
                                    : {}),
                                },
                              ]
                            : old.filter(
                                (v) =>
                                  v.id !== p.id ||
                                  v.organizationId !== p.organizationId,
                              ),
                        )
                      }
                    />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.organizationName}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {!people.some(p => !existing(p)) && (
                <p className="sub">
                  {loading ? "Loading…" : "No matching contacts."}
                </p>
              )}
              <div className="row-actions">
                {offset > 0 && (
                  <button
                    className="button"
                    onClick={() => setOffset(Math.max(0, offset - 50))}
                  >
                    Previous
                  </button>
                )}
                {next !== null && (
                  <button className="button" onClick={() => setOffset(next)}>
                    More people
                  </button>
                )}
              </div>
              {category === "external" && (
                <p className="sub">
                  {data?.external
                    ? "Other companies in this conversation must approve external additions."
                    : "Adding an external contact changes this into an external conversation."}
                </p>
              )}
              </div>
              <div className="lc-participant-footer">
              <button
                className="button primary lc-participant-continue"
                disabled={!chosen.length || loading}
                onClick={() => {
                  setHistory("future");
                  setConvert(false);
                  setStage("review");
                }}
              >
                Continue{chosen.length ? ` · ${chosen.length}` : ""}
              </button>
              </div>
            </>
          ) : (
            <>
              {chosen.map((p) => (
                <div
                  className="lc-participant-person"
                  key={p.organizationId + p.id}
                >
                  <Avatar name={p.name} />
                  <div>
                    <strong>{p.name}</strong>
                    <small>{p.organizationName}</small>
                  </div>
                </div>
              ))}
              <h4>What can they see?</h4>
              <label className="lc-participant-choice">
                <input
                  type="radio"
                  name="participant-history"
                  checked={history === "future"}
                  onChange={() => setHistory("future")}
                />
                <span>
                  <strong>New messages only</strong>
                  <small>From the moment they join.</small>
                </span>
              </label>
              <label className="lc-participant-choice">
                <input
                  type="radio"
                  name="participant-history"
                  checked={history === "all"}
                  onChange={() => setHistory("all")}
                />
                <span>
                  <strong>Previous public messages too</strong>
                  <small>
                    Includes attachments, within your own history access.
                  </small>
                </span>
              </label>
              <p className="sub">
                Internal comments keep their existing permissions. Joining does
                not unlock private threads.
              </p>
              {conversion && (
                <label className="lc-participant-choice">
                  <input
                    type="checkbox"
                    checked={convert}
                    onChange={(e) => setConvert(e.target.checked)}
                  />
                  <span>
                    <strong>Change to an external conversation</strong>
                    <small>
                      Selected contacts outside your company will gain the
                      access chosen above.
                    </small>
                  </span>
                </label>
              )}
              <button
                className="button primary lc-participant-continue"
                disabled={busy || (conversion && !convert)}
                onClick={() => void submit()}
              >
                {busy
                  ? "Saving…"
                  : externalChoice && data?.external
                    ? "Request approval"
                    : "Add to conversation"}
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="lc-participant-error">
          {error}
        </p>
      )}
    </section>
  );
}
