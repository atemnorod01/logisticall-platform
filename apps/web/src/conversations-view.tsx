import { LoadingSkeleton } from "./loading-skeleton.js";
import { subscribeWorkspace } from "./realtime.js";
import type { CallTarget } from "../../../packages/types/src/calls.js";
import { GlobalSearch } from "./chat/global-search.js";
import type { GlobalSearchHit } from "../../../packages/types/src/messaging.js";
import { ConversationDetails } from "./chat/conversation-details.js";
import { AttachmentMenu } from "./chat/attachment-menu.js";
import { attachmentMime } from "../../../packages/types/src/attachment-formats.js";
import { FileThumbnail } from "./chat/file-thumbnail.js";
import { LinkPreview } from "./chat/link-preview.js";
import { RichEditor, emptyDraft, type Draft } from "./chat/rich-editor.js";
import { MessageItem } from "./chat/message-item.js";
import { mountMessageMenus } from "./chat/message-menu.js";
import { conversationDrafts } from "./chat/conversation-drafts.js";
import { continuesMessageGroup, inboxTime } from "./chat/format.js";
import {
  attachmentInput,
  type Message,
  type Attachment,
} from "../../../packages/types/src/messaging.js";
import {
  conversationTitle,
  conversationOrganization,
  isIndividualConversation,
  conversationGroup,
  companyIdentifiers,
} from "./conversation-identity.js";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";
import {
  addressSchema,
  participantDetailsSchema,
  conversationPage,
  type Address,
  type Conversation,
} from "../../../packages/types/src/messaging.js";
import {
  groupList,
  networkGroupList,
  type Group,
} from "../../../packages/types/src/groups.js";
import { messagingController } from "./messaging.js";
import { Avatar, Icon } from "./ui.js";
import { Modal } from "./settings-ui.js";
export function Conversations({
  organizationId,
  organizationName,
  userId,
  userName,
  csrf,
  initialTarget,
  initialConversation,
  onCall,
  callDisabled,
}: {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  csrf: string;
  initialTarget?: string | undefined;
  initialConversation?: Conversation | undefined;
  onCall: (target:CallTarget)=>void;
  callDisabled: boolean;
}) {
  const controller = useMemo(
    () => messagingController(organizationId, csrf),
    [organizationId, csrf],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [groups, setGroups] = useState<Group[]>([]),
    [inboxCounts, setInboxCounts] = useState<Record<string, number>>({}),
    [inboxOrder, setInboxOrder] = useState<string[]>([]),
    [newChat, setNewChat] = useState(false),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [searchHit, setSearchHit] = useState<GlobalSearchHit | null>(null),
    [draft, setDraft] = useState<Draft>(emptyDraft),
    [detail, setDetail] = useState(false),
    [narrow, setNarrow] = useState(false),
    [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]),
    [newMessages, setNewMessages] = useState(false);
  const [searchResults,setSearchResults] = useState<GlobalSearchHit[]>([]);
  const [typingPeople,setTypingPeople]=useState<Record<string,{id:string;name:string;expiresAt:string}[]>>({});
  const typingWatch=JSON.stringify([...new Map([...state.rows,...(state.selected?[state.selected]:[])].filter(c=>!c.readOnly).map(c=>[c.id,{id:c.id,...(c.inbox.kind==="group"?{groupId:c.inbox.id}:{})}])).values()].slice(0,100));
  useEffect(() => {
    setTypingPeople({});
    if (typingWatch === '[]') return;
    let live = true, busy = false, pending = false;
    const load = async () => {
      if (busy) { pending = true; return; }
      busy = true;
      try {
        const result = z.object({ statuses: z.array(z.object({ id: z.string(), people: z.array(z.object({ id: z.string(), name: z.string(), expiresAt: z.string() })) })) })
          .parse(await controller.request(`/typing?${new URLSearchParams({ watch: typingWatch })}`));
        if (live) setTypingPeople(Object.fromEntries(result.statuses.map(r => [r.id, r.people])));
      } catch { if (live) setTypingPeople({}); }
      finally { busy = false; if (pending && live) { pending = false; void load(); } }
    };
    void load();
    const unsubscribe = subscribeWorkspace(organizationId, userId, event => { if (event.kind === 'typing' || event.kind === 'resync') void load(); });
    return () => { live = false; unsubscribe(); };
  }, [organizationId, userId, typingWatch, controller]);
  function typingLabel(id:string) {
    const names=(typingPeople[id]??[]).filter(p=>Date.parse(p.expiresAt)>Date.now()).map(p=>p.name);
    if(!names.length)return "";
    return `${names.join(", ")} ${names.length===1?"is":"are"} typing…`;
  }
  const [callPeople,setCallPeople] = useState<(Address & {presence?:string | undefined})[] | null>(null);
  const [callTeams,setCallTeams] = useState<(Address & {presence?:string | undefined})[]>([]);
  const [callLoading,setCallLoading] = useState(false);
  const callMenu = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!callPeople)return;
    callMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside=(e:PointerEvent)=>{if(!callMenu.current?.contains(e.target as Node))setCallPeople(null);};
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"){setCallPeople(null);callMenu.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  },[Boolean(callPeople)]);
  useEffect(()=>setCallPeople(null),[state.selected?.id]);
  useEffect(()=>{
    if (!callPeople) return;
    let live=true, busy=false;
    const refresh=async()=>{
      if(busy || document.visibilityState!=="visible")return;
      busy=true;
      try {
        const selected=controller.snapshot().selected;
        if(!selected)return;
        const data=participantDetailsSchema.parse(await controller.request(controller.path("/participants")));
        if(!live || controller.snapshot().selected?.id!==selected.id)return;
        setCallTeams(data.participants.filter(p=>p.kind==="group" && p.id!==selected.inbox.id));
        const people=new Map<string,Address & {presence?:string | undefined}>();
        for(const p of data.participants) for(const person of p.kind==="group"?p.members.map(m=>({...p,kind:"user" as const,id:m.id,name:m.name,presence:m.presence})):[p])
          if(person.id!==userId && person.presence==="available")people.set(person.organizationId+person.id,person);
        setCallPeople([...people.values()]);
      } catch { /* Keep menu stable during transient network errors. */ }
      finally {busy=false;}
    };
    const timer=setInterval(()=>void refresh(),5000);
    return()=>{live=false;clearInterval(timer);};
  },[Boolean(callPeople),controller,userId]);

  async function chooseCallPerson() {
    if(callPeople){setCallPeople(null);return;}
    const selected = controller.snapshot().selected;
    if (!selected || callLoading) return;
    if (selected.kind !== "team" && selected.peer.kind === "user") {
      onCall({...selected.peer,conversationId:selected.id,...(state.groupId?{groupId:state.groupId}:{})});
      return;
    }
    setCallLoading(true);
    try {
      const data=participantDetailsSchema.parse(await controller.request(controller.path("/participants")));
      if(controller.snapshot().selected?.id !== selected.id)return;
      setCallTeams(data.participants.filter(p=>p.kind==="group" && p.id!==selected.inbox.id));
      const unique = new Map<string,Address & {presence?:string | undefined}>();
      for(const p of data.participants) {
        const people=p.kind==="group"?p.members.map(m=>({...p,kind:"user" as const,id:m.id,name:m.name,presence:m.presence})):[p];
        for(const person of people) if(!(person.id===userId && person.organizationId===organizationId)) unique.set(person.organizationId+person.id,person);
      }
      const people=[...unique.values()].filter(p=>p.presence==="available");
      setCallPeople(people);
    } catch {setNotice("Could not load people to call. Please try again.");}
    finally {setCallLoading(false);}
  }
  function personAction(person:Address,call:boolean) {
    guard(()=>{void controller.directParticipant({id:person.id,organizationId:person.organizationId}).then(conversation=>{
      if(!conversation)return;
      setDetail(false);setNarrow(true);setSearchOpen(false);setSearchHit(null);
      if(call)onCall({...person,conversationId:conversation.id});
    });});
  }
  const searchOrigin = useRef<Conversation | null>(null), searchSelection = useRef(0);
  function openSearch() {
    guard(() => { searchOrigin.current = controller.snapshot().selected; setDetail(false); setSearchOpen(true); setNarrow(false); });
  }
  function closeSearch() {
    guard(() => { ++searchSelection.current; setSearchOpen(false); setSearchHit(null); if(searchOrigin.current) void controller.select(searchOrigin.current); else controller.clearSelection(); });
  }
  function selectSearchHit(hit: GlobalSearchHit) {
    guard(() => { const ticket=++searchSelection.current;setSearchHit(hit);setNarrow(true);setDetail(false);
      void controller.select(hit.conversation).then(async()=>{
        if(ticket!==searchSelection.current||controller.snapshot().selected?.id!==hit.conversation.id)return;
        if(hit.messageId) await jumpToMessage(hit.messageId);
      });
    });
  }
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
  const draftId = useRef(crypto.randomUUID()),
    pendingDraft = useRef(""),
    drafts = useRef(
      conversationDrafts(
        () => localStorage,
        () =>
          setNotice(
            "Draft saved for this session only; browser storage is unavailable.",
          ),
      ),
    ),
    scroll = useRef<HTMLDivElement>(null),
    inboxTabs = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    viewportHeight = useRef(0),
    previous = useRef({ id: "", last: 0, height: 0, first: 0 });
  const [forwardTargets, setForwardTargets] = useState<Conversation[]>([]),
    [forwardOffset, setForwardOffset] = useState(0),
    [forwardNext, setForwardNext] = useState<number | null>(null),
    [forwardLoading, setForwardLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const [edit, setEdit] = useState<Message | null>(null),
    [editDraft, setEditDraft] = useState<Draft>(emptyDraft),
    [reply, setReply] = useState<Message | null>(null),
    [forward, setForward] = useState<Message | null>(null),
    [forwarded, setForwarded] = useState<string | null>(null),
    [confirm, setConfirm] = useState<{
      title: string;
      action: () => void;
    } | null>(null),
    [notice, setNotice] = useState(""),
    [uploads, setUploads] = useState<
      (Attachment & { pending?: boolean; error?: string; localFile?: File })[]
    >([]),
    [deleting, setDeleting] = useState<string[]>([]);
  useEffect(() => {
    if (!forward) return;
    let live = true;
    setForwardLoading(true);
    if (!forwardOffset) setForwardTargets([]);
    void controller
      .request(`/feed?filter=any&offset=${forwardOffset}`)
      .then((value) => {
        const page = conversationPage.parse(value);
        if (live) {
          setForwardTargets((old) =>
            forwardOffset
              ? [...old, ...page.conversations]
              : page.conversations,
          );
          setForwardNext(page.nextOffset);
        }
      })
      .catch(() => {
        if (live)
          setNotice("Forward destinations could not be loaded. Try again.");
      })
      .finally(() => {
        if (live) setForwardLoading(false);
      });
    return () => {
      live = false;
    };
  }, [forward, forwardOffset, controller]);
  const deleteJobs = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    draftRef = useRef(draft),
    typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    typingLast = useRef(0),
    typingPath = useRef("");
  draftRef.current = draft;
  const scope = `${userId}:${organizationId}`;
  function guard(action: () => void) {
    if (
      edit &&
      (editDraft.text !== edit.body || editDraft.rich !== (edit.rich ?? ""))
    )
      setConfirm({
        title: "Discard draft",
        action: () => {
          setEdit(null);
          action();
        },
      });
    else {
      setEdit(null);
      action();
    }
  }
  function stopTyping() {
    clearTimeout(typingTimer.current);
    if (typingPath.current)
      void controller
        .request(typingPath.current, "POST", { active: false })
        .catch(() => {});
    typingPath.current = "";
    typingLast.current = 0;
  }
  function changeDraft(value: Draft) {
    if(active?.readOnly)return;
    setDraft(value);
    draftRef.current = value;
    if (active && active.hasMessages !== false) {
      drafts.current.write(scope, active.id, value.text, value.rich);
    }
    if (!value.text.trim()) {
      stopTyping();
      return;
    }
    const path = controller.path("/typing");
    if (!path) return;
    if (typingPath.current && typingPath.current !== path) stopTyping();
    typingPath.current = path;
    if (Date.now() - typingLast.current >= 4000) {
      typingLast.current = Date.now();
      void controller.request(path, "POST", { active: true }).catch(() => {});
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 1800);
  }
  async function pickFiles(files: File[]) {
    if (!active) return;
    const key = active.id,
      path = controller.path("/attachments");
    for (const file of files) {
      const check = attachmentInput.safeParse({
        filename: file.name,
        mime: attachmentMime(
          file.name,
          file.type || "application/octet-stream",
        ),
        size: file.size,
      });
      if (!check.success) {
        setNotice(`${file.name}: unsupported type or larger than 25 MB.`);
        continue;
      }
      const token = crypto.randomUUID();
      setUploads((old) => [
        ...old,
        { id: token, ...check.data, pending: true, localFile: file },
      ]);
      try {
        const reserved = (await controller.request(
          path,
          "POST",
          check.data,
        )) as Attachment;
        const root = path.replace(
            "/attachments",
            "/attachments/" + reserved.id,
          ),
          base = `/v1/organizations/${organizationId}/messaging`;
        const result = await fetch(base + root, {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "X-CSRF-Token": csrf,
            "Content-Type": "application/octet-stream",
            "X-File-Type": check.data.mime,
          },
          body: file,
        });
        if (!result.ok) throw Error();
        await controller.request(root.replace("?", "/complete?"), "POST");
        if (controller.snapshot().selected?.id === key)
          setUploads((old) =>
            old.map((v) =>
              v.id === token ? { ...reserved, localFile: file } : v,
            ),
          );
      } catch {
        if (controller.snapshot().selected?.id === key)
          setUploads((old) =>
            old.map((v) =>
              v.id === token
                ? {
                    ...v,
                    pending: false,
                    error: "Upload failed. Remove and retry.",
                  }
                : v,
            ),
          );
      }
    }
  }
  const jumpRequest = useRef(0);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  async function jumpToMessage(id: string) {
    const ticket = ++jumpRequest.current;
    const conversation = controller.snapshot().selected?.id;
    atBottom.current = false;
    while (!controller.snapshot().messages.some(m => m.id === id)) {
      const before = controller.snapshot();
      if (!before.hasMore || before.busy || before.selected?.id !== conversation) break;
      await controller.older();
      const after = controller.snapshot();
      if (ticket !== jumpRequest.current || after.selected?.id !== conversation) return;
      if (after.messages[0]?.id === before.messages[0]?.id) break;
    }
    if (controller.snapshot().selected?.id !== conversation) return;
    if (controller.snapshot().messages.some(m => m.id === id)) setJumpTarget(id);
    else setNotice("The original message is not available. Please try again after messages finish loading.");
  }
  useEffect(() => {
    if (!jumpTarget) return;
    const element = document.getElementById(`message-${jumpTarget}`);
    atBottom.current = false;
    element?.scrollIntoView({block:"center", behavior:"instant"});
    element?.focus({preventScroll:true});
    element?.classList.add("lc-message-jump-highlight");
    const timer = setTimeout(() => { element?.classList.remove("lc-message-jump-highlight"); setJumpTarget(null); }, 1800);
    return () => { clearTimeout(timer); element?.classList.remove("lc-message-jump-highlight"); };
  }, [jumpTarget]);
  function send() {
    if(active?.readOnly)return;
    if (
      !active ||
      state.busy ||
      uploads.some((f) => f.pending || f.error) ||
      (!draft.text.trim() && !uploads.length)
    )
      return;
    const value = { ...draft, text: draft.text.trim() },
      key = active.id,
      extra = {
        rich: value.rich,
        replyTo: reply?.id ?? null,
        forwardedFrom: forwarded,
        attachments: uploads.map((f) => f.id),
      },
      signature = JSON.stringify({ value, extra });
    if (pendingDraft.current !== signature) {
      draftId.current = crypto.randomUUID();
      pendingDraft.current = signature;
    }
    atBottom.current = true;
    void controller
      .send(draftId.current, value.text, false, extra)
      .then((ok) => {
        if (!ok) return;
        const saved = drafts.current.read(scope, key);
        if (saved.text.trim() === value.text && saved.rich === value.rich)
          drafts.current.write(scope, key, "", "");
        if (controller.snapshot().selected?.id === key) {
          if (pendingDraft.current === signature) {
            pendingDraft.current = "";
            draftId.current = crypto.randomUUID();
          }
          if (
            draftRef.current.text.trim() === value.text &&
            draftRef.current.rich === value.rich
          ) {
            setDraft(emptyDraft);
            draftRef.current = emptyDraft;
          }
          setReply((current) =>
            current?.id === extra.replyTo ? null : current,
          );
          setForwarded((current) =>
            current === extra.forwardedFrom ? null : current,
          );
          setUploads((old) =>
            old.filter((f) => !extra.attachments.includes(f.id)),
          );
          stopTyping();
        }
      });
  }
  async function saveEdit() {
    if (!edit) return;
    const original = edit;
    if (editDraft.text === edit.body && editDraft.rich === (edit.rich ?? "")) {
      setEdit(null);
      return;
    }
    if (!editDraft.text.trim() && !edit.attachments?.length) return;
    const ok = await controller.action(
      controller.path(`/messages/${edit.id}`),
      "PATCH",
      { body: editDraft.text, rich: editDraft.rich },
    );
    if (ok)
      setEdit((current) => (current?.id === original.id ? null : current));
  }
  function stageDelete(m: Message) {
    if (deleteJobs.current.has(m.id)) return;
    const path = controller.path(`/messages/${m.id}`);
    setDeleting((old) => [...old, m.id]);
    deleteJobs.current.set(
      m.id,
      setTimeout(() => {
        deleteJobs.current.delete(m.id);
        void controller
          .action(path, "DELETE")
          .finally(() => setDeleting((old) => old.filter((id) => id !== m.id)));
      }, 5000),
    );
  }
  function undoDelete(id: string) {
    clearTimeout(deleteJobs.current.get(id));
    deleteJobs.current.delete(id);
    setDeleting((old) => old.filter((v) => v !== id));
  }
  useEffect(() => {
    mountMessageMenus();
    return () => {
      stopTyping();
      deleteJobs.current.forEach(clearTimeout);
    };
  }, []);
  const active = state.selected,
    detailsVisible = detail && Boolean(active),
    group = groups.find((g) => g.id === state.groupId);
  useEffect(() => {
    void controller.load(initialConversation?.inbox.kind === "group" ? initialConversation.inbox.id : "").then(async () => {
      if(initialConversation){await controller.select(initialConversation);setNarrow(true);}
      else if (initialTarget) {
        const c = await controller.create({
          kind: "user",
          id: initialTarget,
          organizationId,
        });
        if (c) setNarrow(true);
      }
    });
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    async function load() {
      try {
        let offset: number | null = 0;
        const all: Group[] = [];
        while (offset !== null) {
          const r = await fetch(
            `/v1/organizations/${organizationId}/group-inboxes?offset=${offset}`,
            { credentials: "same-origin", signal: ac.signal },
          );
          if (!r.ok) throw Error();
          const page = groupList.parse(await r.json());
          all.push(...page.groups);
          offset = page.nextOffset;
        }
        if (live) setGroups(all);
      } catch {
        /* Conversation API independently rechecks current inbox access. */
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    const unsubscribe = subscribeWorkspace(organizationId, userId, event => { if (event.kind === 'groups' || event.kind === 'profiles' || event.kind === 'resync') void load(); });
    return () => {
      unsubscribe();
      live = false;
      ac.abort();
      clearInterval(timer);
    };
  }, [organizationId, userId]);
  useEffect(() => {
    let live = true,
      busy = false, pending = false;
    const load = async () => {
      if (busy) { pending = true; return; }
      busy = true;
      try {
        const result = z
          .object({
            inboxes: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                unread: z.number(),
              }),
            ),
          })
          .parse(await controller.request("/inboxes"));
        if (!live) return;
        setInboxCounts(
          Object.fromEntries(result.inboxes.map((i) => [i.id, i.unread])),
        );
        const ranked = result.inboxes
          .filter((i) => i.id)
          .sort((a, b) => b.unread - a.unread || a.name.localeCompare(b.name))
          .map((i) => i.id);
        setInboxOrder((old) => [
          ...old.filter((id) => ranked.includes(id)),
          ...ranked.filter((id) => !old.includes(id)),
        ]);
      } catch {
        /* Keep the last counts during a transient refresh failure. */
      } finally {
        busy = false;
        if (pending && live) { pending = false; void load(); }
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    const unsubscribe = subscribeWorkspace(organizationId, userId, event => { if (event.kind !== 'typing' && event.kind !== 'calls') void load(); });
    return () => {
      unsubscribe();
      live = false;
      clearInterval(timer);
    };
  }, [controller, organizationId, userId]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void controller.refresh(); };
    const timer = setInterval(refresh, 60000);
    const unsubscribe = subscribeWorkspace(organizationId, userId, event => { if (event.kind !== 'typing' && event.kind !== 'calls') refresh(); });
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); unsubscribe(); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [controller, organizationId, userId]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void controller.refreshPresence(); };
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [controller]);
  useEffect(() => {
    stopTyping();
    setDraft(
      active?.hasMessages !== false
        ? drafts.current.read(scope, active?.id ?? "")
        : emptyDraft,
    );
    setReply(null);
    setForwarded(null);
    setUploads([]);
    setEdit(null);
    setNotice("");
    draftId.current = crypto.randomUUID();
    pendingDraft.current = "";
    setNewMessages(false);
    atBottom.current = true;
  }, [active?.id]);
  useEffect(() => {
    let live = true;
    setAssignees([]);
    if (state.groupId)
      void controller
        .request(`/assignees?groupId=${state.groupId}`)
        .then((v) => {
          if (live)
            setAssignees(
              z
                .object({
                  members: z.array(
                    z.object({ id: z.uuid(), name: z.string() }),
                  ),
                })
                .parse(v).members,
            );
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [controller, state.groupId]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const old = previous.current,
      id = active?.id ?? "",
      first = state.messages[0]?.sequence ?? 0,
      last = state.messages.at(-1)?.sequence ?? 0;
    if (id !== old.id) atBottom.current = true;
    if (!edit && (id !== old.id || atBottom.current)) {
      el.scrollTop = el.scrollHeight;
    } else if (first < old.first) {
      el.scrollTop += el.scrollHeight - old.height;
    } else if (last > old.last) {
      setNewMessages(true);
    }
    previous.current = { id, first, last, height: el.scrollHeight };
  }, [active?.id, state.messages]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    viewportHeight.current = el.clientHeight;
    const resize = new ResizeObserver(() => {
      viewportHeight.current = el.clientHeight;
      // Follow composer expansion and window resizing when already at the bottom.
      // A reader browsing older history keeps their position instead.
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      previous.current.height = el.scrollHeight;
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (atBottom.current && (narrow || window.innerWidth > 850))
      void controller.read().catch(() => {});
  }, [state.messages, controller, narrow]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current && !edit) el.scrollTop = el.scrollHeight;
      previous.current.height = el.scrollHeight;
    });
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [state.messages, edit]);
  function chooseInbox(id: string) {
    guard(() => {
      setSearch("");
      setNarrow(false);
      void controller.load(id, state.filter, "");
    });
  }
  const format = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <div
      className={`chat-layout lc-messaging ${searchOpen ? "lc-search-open" : ""} ${detailsVisible ? "contact-revealed" : "contact-closed"} ${narrow ? "narrow-thread" : ""}`}
    >
      <section className="inbox">
        <GlobalSearch onResults={setSearchResults} controller={controller} organizationId={organizationId} groups={groups} visible={searchOpen} selected={searchHit?.key??null} onSelect={selectSearchHit} onClose={closeSearch}/>
        <div className="lc-normal-inbox" hidden={searchOpen}>
        <div className="inbox-head">
          <div className="inbox-title">
            <h1>Conversations</h1>
            <div>
              <button
                className="icon"
                aria-label="Refresh conversations"
                onClick={() => void controller.refresh()}
              >
                <Icon name="refresh" />
              </button>
              <button
                className="icon"
                aria-label="New conversation"
                onClick={() => guard(() => setNewChat(true))}
              >
                <Icon name="plus" />
              </button>
            </div>
          </div>
          <nav className="lc-inbox-tabs" aria-label="Conversation inboxes">
              <button
                className="lc-inbox-tab"
                aria-pressed={state.scope === ""}
                onClick={() => chooseInbox("")}
              >
                My chats
                <span
                  className="lc-inbox-count"
                  style={{ visibility: inboxCounts[""] ? "visible" : "hidden" }}
                >
                  {(inboxCounts[""] ?? 0) > 99 ? "99+" : (inboxCounts[""] ?? 0)}
                </span>
              </button>
            <div className="lc-shared-tabs" ref={inboxTabs}>
              {[...groups]
                .sort(
                  (a, b) =>
                    (inboxOrder.indexOf(a.id) < 0
                      ? 99999
                      : inboxOrder.indexOf(a.id)) -
                    (inboxOrder.indexOf(b.id) < 0
                      ? 99999
                      : inboxOrder.indexOf(b.id)),
                )
                .map((g) => (
                  <button
                    key={g.id}
                    className="lc-inbox-tab"
                    aria-pressed={state.scope === g.id}
                    onClick={(e) => {
                      chooseInbox(g.id);
                      e.currentTarget.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                      });
                    }}
                  >
                    {g.name}
                    <span
                      className="lc-inbox-count"
                      style={{
                        visibility: inboxCounts[g.id] ? "visible" : "hidden",
                      }}
                    >
                      {(inboxCounts[g.id] ?? 0) > 99
                        ? "99+"
                        : (inboxCounts[g.id] ?? 0)}
                    </span>
                  </button>
                ))}
            </div>
            {groups.length > 0 && (
              <button
                className="lc-inbox-scroll"
                aria-label="Scroll conversation inboxes"
                onClick={() => {
                  const el = inboxTabs.current!;
                  el.scrollTo({
                    left:
                      el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
                        ? 0
                        : el.scrollLeft + 120,
                    behavior: "smooth",
                  });
                }}
              >
                ›
              </button>
            )}
          </nav>
          <label className="lc-message-search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search all conversations"
              placeholder="Search all conversations…"
              onFocus={openSearch}
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                guard(() => {setSearch(value);openSearch();});
              }}
            />
          </label>
          <div className="tabs">
            {["all", "unread", "done"].map((f) => (
              <button
                key={f}
                className={state.filter === f ? "active" : ""}
                onClick={() =>
                  guard(() => {
                    void controller.load(state.scope, f, search);
                  })
                }
              >
                {f === "all"
                  ? "All conversations"
                  : f === "unread"
                    ? "Unread"
                    : "Done"}
              </button>
            ))}
          </div>
        </div>
        <div className="lc-conversation-list" aria-busy={state.loading}>
          {state.rows.map((c) => (
            <button
              key={c.id}
              className={`conversation ${active?.id === c.id ? "active" : ""}`}
              onClick={() => {
                guard(() => {
                  setNarrow(true);
                  void controller.select(c);
                });
              }}
              aria-pressed={active?.id === c.id}
            >
              <span
                className={`conversation-avatar ${!isIndividualConversation(c) && c.peer.organizationId !== organizationId && c.identity?.inNetwork ? "lc-network-avatar" : ""}`}
                title={
                  !isIndividualConversation(c) && c.peer.organizationId !== organizationId &&
                  c.identity?.inNetwork
                    ? "Company in your network"
                    : undefined
                }
              >
                <ChatAvatar
                  conversation={c}
                  organizationId={organizationId}
                  userId={userId}
                />
              </span>
              <span className="conversation-copy">
                <span className="conversation-card-top">
                  <span className="lc-company-title-row">
                    <strong>{conversationTitle(c, organizationId)}{isIndividualConversation(c) && c.peer.organizationId !== organizationId && <span className="lc-direct-company"> · {c.peer.organizationName}</span>}</strong>
                    {conversationGroup(c, organizationId) && <span className="lc-peer-group-badge" title={conversationGroup(c, organizationId)}>{conversationGroup(c, organizationId)}</span>}
                  </span>
                  <time>{inboxTime(c.updatedAt)}</time>
                </span>
                <span className="conversation-card-bottom">
                  <small>
                    {typingLabel(c.id) ? <span className="lc-typing-label">{typingLabel(c.id)}</span> : drafts.current.read(scope, c.id).text.trim() ? (
                      <>
                        <span className="lc-draft-label">Draft:</span>{" "}
                        {drafts.current
                          .read(scope, c.id)
                          .text.replace(/\s+/g, " ")}
                      </>
                    ) : (
                      c.preview
                    )}
                  </small>
                  {c.unread > 0 && (
                    <span className="conversation-unread">
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {!state.rows.length && (
            <div className={state.loading ? "" : "empty"}>
              {state.loading
                ? <LoadingSkeleton />
                : state.error
                  ? "Conversations unavailable."
                  : "No conversations here yet."}
            </div>
          )}
          {state.nextOffset !== null && (
            <button
              className="button"
              disabled={state.busy}
              onClick={() => void controller.more()}
            >
              Load more
            </button>
          )}
        </div>
        </div>
      </section>
      <section className="thread">
        <div className="thread-head">
          <div className="person">
            <button
              className="icon lc-inbox-back"
              aria-label="Back to conversations"
              onClick={() => {
                guard(() => {
                  controller.leaveEmpty();
                  setNarrow(false);
                });
              }}
            >
              <Icon name="arrow-left" />
            </button>
            {active && (
              <span
                className={`conversation-avatar ${!isIndividualConversation(active) && active.peer.organizationId !== organizationId && active.identity?.inNetwork ? "lc-network-avatar" : ""}`}
                title={
                  !isIndividualConversation(active) && active.peer.organizationId !== organizationId &&
                  active.identity?.inNetwork
                    ? "Company in your network"
                    : undefined
                }
              >
                <ChatAvatar
                  conversation={active}
                  organizationId={organizationId}
                  userId={userId}
                />
              </span>
            )}
            <div>
              <div className="lc-company-title-row">
              {active?.kind === "team" && !active.readOnly ? <GroupNameHeading key={active.id} controller={controller} title={active.title ?? ""} displayName={conversationTitle(active, organizationId)}/> : <h2>{active ? conversationTitle(active, organizationId) : "Messages"}</h2>}
              {active && conversationGroup(active, organizationId) && <span className="lc-peer-group-badge" title={conversationGroup(active, organizationId)}>{conversationGroup(active, organizationId)}</span>}
              </div>
              {active?.kind === "team" && <small>Group conversation</small>}
              {active && conversationOrganization(active) && <small>{conversationOrganization(active)}</small>}
              {active && !isIndividualConversation(active) && active.peer.organizationId !== organizationId && (
                <>
                  {companyIdentifiers(active) && (
                    <small className="lc-company-identifiers">
                      {companyIdentifiers(active)}
                    </small>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="row-actions lc-thread-header-actions">
            {active && state.groupId && (
              <select
                aria-label="Assign conversation"
                value={active.assignedTo ?? ""}
                disabled={state.busy}
                onChange={(e) =>
                  void controller.update({ assignedTo: e.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id === userId ? "Me" : a.name}
                  </option>
                ))}
              </select>
            )}
            {active && (
              <button
                className="button"
                disabled={state.busy}
                onClick={() => void controller.update({ done: !active.done })}
              >
                {active.done ? "Reopen" : "Mark done"}
              </button>
            )}
            <div className="lc-call-menu-anchor" ref={callMenu}>
            <button
              className="icon"
              disabled={!active || active.readOnly || callLoading || callDisabled}
              title="Call someone in this conversation"
              aria-label="Call contact"
              aria-haspopup="menu"
              aria-expanded={Boolean(callPeople)}
              onClick={()=>void chooseCallPerson()}
            ><Icon name="phone" /></button>
            {callPeople && <div className="lc-call-dropdown" role="menu" aria-label="Call a participant" onKeyDown={e=>{
              if(!["ArrowDown","ArrowUp","Home","End"].includes(e.key))return;
              e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);
              items[e.key==="Home"?0:e.key==="End"?items.length-1:(index+(e.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();
            }}>
              {callTeams.map(team=><div className="lc-call-team-option" key={team.id}><button role="menuitem" className="button" onClick={()=>{setCallPeople(null);onCall({...team,kind:"group",conversationId:active!.id,...(state.groupId?{groupId:state.groupId}:{})});}}><Avatar name={team.organizationName} presence={team.presence}/><span><strong>Call {team.name}</strong><small>{team.organizationName}</small></span><Icon name="phone"/></button></div>)}
              <div className="lc-call-menu-heading">Available people</div>
              {!callPeople.length && <div className="lc-call-menu-heading">No members are available right now.</div>}
              <div className="lc-call-people">{callPeople.map(person=><button role="menuitem" className="button" key={person.organizationId+person.id} onClick={()=>{setCallPeople(null);onCall({...person,conversationId:active!.id,...(state.groupId?{groupId:state.groupId}:{})});}}><Avatar name={person.name} presence={person.presence}/><span><strong>{person.name}</strong><small>{person.organizationName}</small></span><Icon name="phone"/></button>)}</div>
            </div>}
            </div>
            <button
              className="icon"
              disabled={!active}
              aria-label="Conversation details"
              aria-pressed={detailsVisible}
              onClick={() => setDetail(!detail)}
            >
              <Icon name="more" />
            </button>
          </div>
        </div>
        {searchHit && <div className="lc-search-match-bar"><span>{searchHit.internal ? "Internal comment" : "Search match"} · {searchHit.author}</span><div className="lc-search-match-actions">{searchOpen && [-1,1].map(step=><button key={step} className="button" aria-label={step<0?"Previous search result":"Next search result"} disabled={!searchResults.length} onClick={()=>{const i=searchResults.findIndex(r=>r.key===searchHit.key);const next=searchResults[(i+step+searchResults.length)%searchResults.length];if(next)selectSearchHit(next);}}>{step<0?"↑":"↓"}</button>)}<button className="button" onClick={()=>{setSearchOpen(v=>!v);setNarrow(false);}}>{searchOpen?"Open conversation →":"← Search results"}</button></div></div>}
        <div
          className="messages"
          ref={scroll}
          onScroll={() => {
            const e = scroll.current!;
            // Resize-generated scroll events must not cancel bottom following.
            if (
              e.clientHeight !== viewportHeight.current ||
              e.scrollHeight !== previous.current.height
            ) return;
            atBottom.current =
              e.scrollHeight - e.scrollTop - e.clientHeight < 40;
            if (e.scrollTop < 120 && state.hasMore && !state.busy)
              void controller.older();
            if (atBottom.current) {
              setNewMessages(false);
              void controller.read().catch(() => {});
            }
          }}
        >
          {state.hasMore && (
            <button
              className="button lc-older"
              disabled={state.busy}
              onClick={() => void controller.older()}
            >
              Earlier messages
            </button>
          )}
          {!active ? (
            <div className="empty">
              <h2>Your conversations, together</h2>
              <p className="sub">Choose a conversation or start a new one.</p>
              <button
                className="button"
                onClick={() => guard(() => setNewChat(true))}
              >
                New conversation
              </button>
            </div>
          ) : !state.messages.length ? (
            <div className={state.timelineLoading ? "" : "empty"}>
              {state.timelineLoading
                ? <LoadingSkeleton variant="messages" rows={4} />
                : `Start the conversation with ${active.peer.name}.`}
            </div>
          ) : (
            state.messages.map((m, i) => (
              <div key={m.id}>
                {active.systemEvents?.filter(e=>new Date(e.createdAt).getTime()<=new Date(m.createdAt).getTime() && (i===0 || new Date(e.createdAt).getTime()>new Date(state.messages[i-1]!.createdAt).getTime())).map(e=><p className="lc-group-system-event" key={e.id}>{e.text}</p>)}
                {(i === 0 ||
                  new Date(state.messages[i - 1]!.createdAt).toDateString() !==
                    new Date(m.createdAt).toDateString()) && (
                  <div className="timeline-day">
                    {new Date(m.createdAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                )}
                <MessageItem
                  readOnly={!!active.readOnly}
                  message={m}
                  onPerson={()=>setDetail(true)}
                  senderPresence={m.senderPresence}
                  searchCommentId={searchHit?.messageId===m.id?searchHit.commentId:null}
                  canComment={!active.readOnly && !m.outgoing && !m.internal && !m.deletedAt && (active.external ?? active.peer.organizationId !== organizationId)}
                  sharedInbox={!!state.groupId}
                  commentBusy={state.busy || !!m.deletedAt}
                  onComment={(id, body) => controller.send(id, body, true, { replyTo: m.id })}
                  continuation={continuesMessageGroup(m, state.messages[i - 1])}
                  continuesNext={!!state.messages[i + 1] && continuesMessageGroup(state.messages[i + 1]!, m)}
                  onJump={(id) => void jumpToMessage(id)}
                  source={state.messages.find((v) => v.id === m.replyTo)}
                  latestOwn={
                    (m.own ?? m.outgoing) &&
                    state.messages.filter((v) => v.own ?? v.outgoing).at(-1)
                      ?.id === m.id
                  }
                  editing={edit?.id === m.id}
                  editDraft={editDraft}
                  setEditDraft={setEditDraft}
                  onEdit={() =>
                    guard(() => {
                      setEdit(m);
                      setEditDraft({ text: m.body, rich: m.rich ?? "" });
                      atBottom.current = false;
                    })
                  }
                  onCancel={() => guard(() => {})}
                  onSave={() => void saveEdit()}
                  onReply={() => {
                    setReply(m);
                    setForwarded(null);
                    document
                      .getElementById("conversation-draft")
                      ?.focus({ preventScroll: true });
                  }}
                  onForward={() => {
                    setForwardOffset(0);
                    setForward(m);
                  }}
                  onReact={(emoji) =>
                    void controller.action(
                      controller.path(`/messages/${m.id}/reactions`),
                      "POST",
                      { emoji },
                    )
                  }
                  onDelete={() => stageDelete(m)}
                  pending={deleting.includes(m.id)}
                  onUndo={() => undoDelete(m.id)}
                  request={controller.request}
                  mediaUrl={(id) => controller.path(`/attachments/${id}`)}
                />
              </div>
            ))
          )}
          {active?.systemEvents?.filter(e=>!state.messages.length || new Date(e.createdAt).getTime()>new Date(state.messages.at(-1)!.createdAt).getTime()).map(e=><p className="lc-group-system-event" key={e.id}>{e.text}</p>)}
        </div>
        <div className="lc-new-message-slot">
          {newMessages && (
            <button
              className="button"
              onClick={() => {
                scroll.current!.scrollTop = scroll.current!.scrollHeight;
                atBottom.current = true;
                setNewMessages(false);
              }}
            >
              New messages ↓
            </button>
          )}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {state.groupId && (
            <div className="lc-send-identity">
              <span>Replying as {group?.name ?? "Team"}</span>
            </div>
          )}
          {forwarded && (
            <div className="lc-composer-reference">
              <span>Forwarded message</span>
              <button type="button" aria-label="Cancel forward" onClick={() => setForwarded(null)}>×</button>
            </div>
          )}
          <LinkPreview text={draft.text} rich={draft.rich} request={controller.request} />
          {!!uploads.length && (
            <div className="lc-upload-list">
              {uploads.map((f) => (
                <DraftAttachment
                  key={f.id}
                  file={f.localFile}
                  filename={f.filename}
                  pending={f.pending}
                  error={f.error}
                  onRemove={() =>
                    setUploads((old) => old.filter((v) => v.id !== f.id))
                  }
                />
              ))}
            </div>
          )}
          {active?.readOnly && <p className="lc-left-group-notice">You are no longer in this group. Your earlier messages are read-only.</p>}
          <div className="composer-entry">
            <AttachmentMenu key={active?.id ?? "none"} disabled={!active || !!active.readOnly} onFiles={(files) => void pickFiles(files)} />
            <RichEditor
              id="conversation-draft"
              reference={reply && (
                <div className="lc-reply-quote" role="group" aria-label="Quoted message">
                  <div className="lc-reply-quote-content">
                    <div className="lc-reply-quote-heading">
                      <span>{reply.actorName || reply.senderName}</span>
                      <time dateTime={reply.createdAt}>{new Date(reply.createdAt).toLocaleString([], {month:"numeric",day:"numeric",year:"2-digit",hour:"numeric",minute:"2-digit"})}</time>
                    </div>
                    <p>{reply.deletedAt ? "This message has been deleted." : reply.body || reply.attachments.map(file => file.filename).join(" · ") || "Original message"}</p>
                  </div>
                  <button type="button" aria-label="Cancel quoted reply" title="Cancel quoted reply" onClick={() => {setReply(null);document.getElementById("conversation-draft")?.focus({preventScroll:true});}}>×</button>
                </div>
              )}
              onClear={() => { setUploads([]); setReply(null); setForwarded(null); }}
              value={draft}
              onChange={changeDraft}
              onSend={send}
              onFiles={(files) => void pickFiles(files)}
              disabled={!active || !!active.readOnly}
            />
            <button
              className="button primary"
              type="submit"
              disabled={
                !active || active.readOnly ||
                state.busy ||
                uploads.some((f) => f.pending || f.error) ||
                (!draft.text.trim() && !uploads.length)
              }
              aria-label="Send message"
            >
              <Icon name="send" />
            </button>
          </div>
          <div className="lc-messaging-status" role="status" aria-live="polite">
            {state.error ||
              notice ||
              (active ? typingLabel(active.id) : "") ||
              (state.busy ? "Saving…" : "")}
          </div>
        </form>
      </section>
      {detailsVisible && active && (
        <aside className="chat-detail">
          <header className="section-head">
            <h2>Conversation details</h2>
            <button
              className="icon"
              aria-label="Close conversation details"
              onClick={() => setDetail(false)}
            >
              ×
            </button>
          </header>
          <ConversationDetails onPersonAction={personAction} key={`${organizationId}:${active.id}:${active.inbox.id}`} controller={controller} organizationId={organizationId} userId={userId}/>

        </aside>
      )}

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p>
            {confirm.title === "Discard draft"
              ? "Discard your unsaved message edit?"
              : "Replace the saved text draft in this conversation?"}
          </p>
          <div className="row-actions">
            <button className="button" onClick={() => setConfirm(null)}>
              {confirm.title === "Discard draft" ? "Cancel" : "Keep draft"}
            </button>
            <button
              className="button primary"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              {confirm.title === "Discard draft" ? "Discard" : "Replace draft"}
            </button>
          </div>
        </Modal>
      )}
      {forward && (
        <Modal title="Forward message" onClose={() => setForward(null)}>
          <div className="lc-new-chat-results">
            {forwardTargets
              .filter((c) => c.id !== active?.id)
              .map((c) => (
                <button
                  className="conversation"
                  key={c.id + c.inbox.id}
                  onClick={() => {
                    const source = forward;
                    const action = () => {
                      drafts.current.write(
                        scope,
                        c.id,
                        source.body,
                        source.rich ?? "",
                      );
                      void controller.select(c).then(() => {
                        setDraft({
                          text: source.body,
                          rich: source.rich ?? "",
                        });
                        setForwarded(source.id);
                        setReply(null);
                        setUploads([]);
                        setNarrow(true);
                      });
                      setForward(null);
                    };
                    if (drafts.current.read(scope, c.id).text.trim())
                      setConfirm({ title: "Replace saved draft?", action });
                    else guard(action);
                  }}
                >
                  <span>
                    <span className="lc-company-title-row">
                    <strong>{conversationTitle(c, organizationId)}</strong>
                    {conversationGroup(c, organizationId) && <span className="lc-peer-group-badge" title={conversationGroup(c, organizationId)}>{conversationGroup(c, organizationId)}</span>}
                  </span>
                    <small>
                      {c.inbox.kind === "group" ? c.inbox.name : "My chats"}
                    </small>
                  </span>
                </button>
              ))}
          </div>
          <div role="status" className={forwardLoading && !forwardTargets.length ? "" : "lc-messaging-status"}>
            {forwardLoading
              ? !forwardTargets.length ? <LoadingSkeleton rows={4} /> : null
              : !forwardTargets.length
                ? "No other conversations yet."
                : notice}
          </div>
          {forwardNext !== null && (
            <button
              className="button"
              disabled={forwardLoading}
              onClick={() => setForwardOffset(forwardNext)}
            >
              Load more conversations
            </button>
          )}
          <button className="button" onClick={() => setForward(null)}>
            Cancel
          </button>
        </Modal>
      )}
      {newChat && (
        <NewConversation
          organizationId={organizationId}
          userId={userId}
          controller={controller}
          from={group?.name ?? userName}
          organizationName={organizationName}
          busy={state.busy}
          error={state.error}
          onClose={() => setNewChat(false)}
          onCreated={() => {
            setNewChat(false);
            setNarrow(true);
          }}
        />
      )}
    </div>
  );
}
function NewConversation({
  organizationId,
  userId,
  controller,
  from,
  organizationName,
  busy,
  error,
  onClose,
  onCreated,
}: {
  organizationId: string;
  userId: string;
  controller: ReturnType<typeof messagingController>;
  from: string;
  organizationName: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tab, setTab] = useState("people"),
    [chosen, setChosen] = useState<Address[]>([]),
    [title, setTitle] = useState(""),
    [search, setSearch] = useState(""),
    [rows, setRows] = useState<Address[]>([]),
    [loading, setLoading] = useState(false),
    [failure, setFailure] = useState(""),
    [next, setNext] = useState<number | null>(null),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailure("");
    setRows([]);
    setNext(null);
    const ac = new AbortController();
    const t = setTimeout(() => {
      void (async () => {
        try {
          if (tab !== "groups") {
            const result = z
              .object({
                people: z.array(addressSchema),
                nextOffset: z.number().nullable(),
              })
              .parse(
                await controller.request(
                  `/people?${new URLSearchParams({ search, offset: String(offset), ...(controller.snapshot().groupId ? { groupId: controller.snapshot().groupId } : {}) })}`,
                ),
              );
            if (live) {
              setRows(
                result.people.filter((p) =>
                  controller.snapshot().groupId
                    ? p.organizationId !== organizationId
                    : p.id !== userId || p.organizationId !== organizationId,
                ),
              );
              setNext(result.nextOffset);
            }
          } else {
            const response = await fetch(
              `/v1/organizations/${organizationId}/network-groups?${new URLSearchParams({ search, offset: String(offset) })}`,
              { signal: ac.signal, credentials: "same-origin" },
            );
            if (!response.ok) throw Error();
            const p = networkGroupList.parse(await response.json());
            if (live) {
              setRows(
                p.groups
                  .filter((g) => g.organization_id !== organizationId)
                  .map((g) => ({
                    kind: "group",
                    id: g.id,
                    name: g.name,
                    organizationId: g.organization_id,
                    organizationName: g.organization_name,
                  })),
              );
              setNext(p.nextOffset);
            }
          }
        } catch {
          if (live)
            setFailure("Contacts could not be loaded. Try searching again.");
        } finally {
          if (live) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
      ac.abort();
    };
  }, [tab, search, offset, controller, organizationId, userId]);
  return (
    <Modal title="New conversation" onClose={onClose}>
      <div className="lc-new-chat">
        <p className="sub">
          From {from} · {organizationName}
        </p>
        <div className="tabs">
          {["people", "team", "groups"]
            .filter((t) => t !== "team" || !controller.snapshot().groupId)
            .map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => {
                  setTab(t);
                  setSearch("");
                  setChosen([]);
                  setOffset(0);
                }}
              >
                {t === "people"
                  ? "People"
                  : t === "team"
                    ? "Team group chat"
                    : "Teams"}
              </button>
            ))}
        </div>
        <input
          type="search"
          autoFocus
          aria-label="Find people or teams"
          placeholder={
            tab === "people"
              ? "Name or exact email in another organization"
              : tab === "team" ? "Search coworkers" : "Search teams"
          }
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          maxLength={tab === "people" ? 254 : 100}
        />
        <div className="lc-new-chat-results" aria-busy={loading}>
          {rows
            .filter(
              (r) => tab !== "team" || r.organizationId === organizationId,
            )
            .map((r) => (
              <button
                className="lc-new-chat-person"
                role={tab === "team" ? "checkbox" : undefined}
                aria-checked={tab === "team" ? chosen.some(p => p.id === r.id) : undefined}
                disabled={busy}
                key={r.organizationId + ":" + r.id}
                onClick={() =>
                  tab === "team"
                    ? setChosen((old) =>
                        old.some((p) => p.id === r.id)
                          ? old.filter((p) => p.id !== r.id)
                          : [...old, r],
                      )
                    : void controller
                        .create({
                          kind: r.kind,
                          id: r.id,
                          organizationId: r.organizationId,
                          ...(r.organizationId !== organizationId &&
                          r.kind === "user"
                            ? { email: search.trim() }
                            : {}),
                        })
                        .then((c) => {
                          if (c) onCreated();
                        })
                }
              >
                {tab === "team" && <span className="lc-new-chat-check" aria-hidden="true">{chosen.some(p => p.id === r.id) ? "✓" : ""}</span>}
                <Avatar name={r.name} />
                <span className="lc-new-chat-person-name">
                  <strong>{r.name}</strong>
                  <small>{r.organizationName}</small>
                </span>
                {tab !== "team" && <Icon name="chevron" />}
              </button>
            ))}
          {!rows.length && (
            <div className={loading ? "" : "empty"}>
              {loading ? <LoadingSkeleton rows={4} /> : failure || "No matching contacts."}
            </div>
          )}
        </div>
        {tab === "team" && (
          <>
            <label>
              Group title (optional)
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <p className="sub">{chosen.length} {chosen.length === 1 ? "recipient" : "recipients"} selected</p>
            <button
              className="button primary"
              disabled={busy || chosen.length < 2}
              onClick={() =>
                void controller
                  .createTeam(
                    chosen.map((p) => p.id),
                    title,
                  )
                  .then((c) => {
                    if (c) onCreated();
                  })
              }
            >
              Start group chat
            </button>
          </>
        )}
        {(offset > 0 || next !== null) && <div className="lc-new-chat-footer">
          <button
            className="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous
          </button>
          <button
            className="button"
            disabled={next === null || loading}
            onClick={() => setOffset(next!)}
          >
            Next
          </button>
        </div>}
        <div className="lc-messaging-status" role="status">
          {error}
        </div>
      </div>
    </Modal>
  );
}

function GroupNameHeading({controller, title, displayName}: {controller: ReturnType<typeof messagingController>;title: string;displayName: string}) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(title), [saving, setSaving] = useState(false), [error, setError] = useState("");
  if (!editing) return <><h2 title={displayName}>{displayName}</h2><button className="icon lc-rename-group" aria-label="Edit group name" title="Edit group name" onClick={() => {setName(title);setError("");setEditing(true);}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button></>;
  return <form className="lc-inline-group-name" onSubmit={async event => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);setError("");
    const ok = await controller.action(controller.path("/name"), "PATCH", {title:name.trim()});
    setSaving(false);
    if (ok) setEditing(false); else setError("Could not save. Try again.");
  }}>
    <input aria-label="Group name" autoFocus maxLength={200} value={name} onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} onKeyDown={e => {if(e.key === "Escape" && !saving) {e.preventDefault();setEditing(false);}}} placeholder="Group name (optional)" disabled={saving} title="Shared with everyone. Clear to show participant names."/>
    <button type="submit" className="icon" aria-label="Save group name" disabled={saving}>✓</button>
    <button type="button" className="icon" aria-label="Cancel group name edit" disabled={saving} onClick={() => setEditing(false)}>×</button>
    {error && <small role="alert">{error}</small>}
  </form>;
}

function ChatAvatar({
  conversation: c,
  organizationId,
  userId,
}: {
  conversation: Conversation;
  organizationId: string;
  userId: string;
}) {
  const external = c.peer.organizationId !== organizationId;
  const individual = isIndividualConversation(c);
  const network = external && !individual && Boolean(c.identity?.inNetwork);
  if (c.kind === "team") {
    const peers = c.participants?.filter(p => p.id !== userId).slice(0, 4) ?? [];
    return <span className={`lc-group-avatars lc-group-segments-${peers.length}`} role="img" aria-label={`Group conversation: ${peers.map(p => p.name).join(", ")}`}>
      {peers.map(p => <span className="lc-group-segment" key={p.id} title={p.name}><Avatar name={p.name}/></span>)}
    </span>;
  }
  return (
    <Avatar
      name={conversationTitle(c, organizationId)}
      inNetwork={network}
      presence={c.identity?.presence ?? "unknown"}
    />
  );
}

function DraftAttachment({
  file,
  filename,
  pending,
  error,
  onRemove,
}: {
  file?: File | undefined;
  filename: string;
  pending?: boolean | undefined;
  error?: string | undefined;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className={`lc-draft-attachment ${file?.type.startsWith("video/") ? "lc-draft-video" : ""}`} title={filename}>
      {preview && file?.type.startsWith("video/") ? (
        <video src={preview} controls playsInline preload="metadata" aria-label={`Preview ${filename}`} />
      ) : preview ? (
        <FileThumbnail
          url={preview}
          mime={attachmentMime(
            filename,
            file?.type || "application/octet-stream",
          )}
          name={filename}
        />
      ) : (
        <span className="lc-draft-file">
          <span aria-hidden="true">▤</span>
          <span>{filename}</span>
        </span>
      )}
      {(pending || error) && (
        <span className="lc-draft-upload-status" role="status">
          {error ?? "Uploading…"}
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${filename}`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
