import { workspaceEvents, type WorkspaceChange } from "./realtime.js";
import { randomUUID } from "node:crypto";
import { personalContact, personalContactInput } from "../../../packages/types/src/personal-contacts.js";
import { mediaSignature, validMediaSignature } from "./media-signature.js";
import { linkPreview } from "./link-preview.js";
import {
  onGroupIdentityChanged,
  groupIdentityChanged,
} from "./messaging-events.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createConversation,
  globalSearchInput,
  addParticipantsInput,
  editMessage,
  teamConversation,
  attachmentInput,
  sendMessage,
  updateConversation,
  type Address,
} from "../../../packages/types/src/messaging.js";
import {
  MessageFailure,
  type MessageActor,
  type MessagingStore,
} from "./messaging-store.js";
import type { GroupStore, GroupActor } from "./groups-store.js";
import type { iamGroupEligibility, iamMessaging } from "./iam.js";
export function messagingRoutes(
  app: FastifyInstance,
  options: {
    store?: MessagingStore | undefined;
    groups?: GroupStore | undefined;
    eligibility: ReturnType<typeof iamGroupEligibility>;
    directory: ReturnType<typeof iamMessaging>;
    authorize: (
      req: FastifyRequest,
      org: string,
    ) => Promise<{ actor: GroupActor; token: string; member?: Awaited<ReturnType<ReturnType<typeof iamGroupEligibility>["member"]>> }>;
  },
) {
  const prefix = "/v1/organizations/:organizationId/messaging";
  const params = (req: FastifyRequest) =>
    z
      .object({
        organizationId: z.uuid(),
        conversationId: z.uuid().optional(),
        messageId: z.uuid().optional(),
        attachmentId: z.uuid().optional(),
      })
      .parse(req.params);
  async function auth(req: FastifyRequest) {
    const p = params(req);
    const v = await options.authorize(req, p.organizationId);
    if (!options.store || !options.groups) throw new MessageFailure(503);
    const m = v.member ?? await options.eligibility.member(
      v.token,
      p.organizationId,
      v.actor.userId,
    );
    return {
      ...v,
      actor: {
        userId: m.user_id,
        organizationId: p.organizationId,
        name: m.name,
        membershipKey: m.membership_key,
      } satisfies MessageActor,
      organizationName: v.actor.organizationName,
      store: options.store,
      groups: options.groups,
    };
  }
  type Auth = Awaited<ReturnType<typeof auth>>;
  async function inbox(a: Auth, groupId?: string): Promise<Address> {
    if (groupId) {
      const g = await a.groups.inbox(
        { ...a.actor, organizationName: a.organizationName },
        groupId,
        a.actor.membershipKey,
      );
      return {
        kind: "group",
        id: g.id,
        organizationId: g.organization_id,
        name: g.name,
        organizationName: a.organizationName,
      };
    }
    return {
      kind: "user",
      id: a.actor.userId,
      organizationId: a.actor.organizationId,
      name: a.actor.name,
      organizationName: a.organizationName,
      membershipKey: a.actor.membershipKey,
    };
  }
  const query = z.object({ groupId: z.uuid().optional() });
  app.addHook("onResponse", async (req, reply) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      reply.statusCode < 300 &&
      req.url.includes("/messaging/") && !req.url.includes("/typing")
    ) {
      const id = (req.params as { conversationId?: string }).conversationId;
      if (id) groupIdentityChanged(id);
    }
  });
  async function mapInboxes<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
      while (next < items.length) { const i = next++; results[i] = await work(items[i]!); }
    }));
    return results;
  }
  async function accessibleInboxes(a: Auth) {
    const addresses: Address[] = [await inbox(a)];
    for (let offset = 0; ; offset += 50) {
      const groups = await a.groups.list(
        { ...a.actor, organizationName: a.organizationName },
        offset,
        a.actor.membershipKey,
      );
      addresses.push(
        ...groups.map((g) => ({
          kind: "group" as const,
          id: g.id,
          organizationId: g.organization_id,
          name: g.name,
          organizationName: a.organizationName,
        })),
      );
      if (groups.length < 50) break;
    }
    return addresses;
  }
  app.get(prefix + "/events", async (req, reply) => {
    const initial = await auth(req);
    const { userId } = z.object({ userId: z.uuid() }).strict().parse(req.query);
    if (initial.actor.userId !== userId) throw new MessageFailure(403);
    const target = `${initial.actor.organizationId}:${userId}`;
    const memberTarget = `${target}:${initial.actor.membershipKey}`;
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    reply.raw.write('retry: 2000\n\nevent: change\ndata: {"kind":"resync"}\n\n');
    const pending = new Map<string, { kind: WorkspaceChange['kind'] | 'resync'; conversationId?: string; selfProfile?: boolean }>();
    let timer: ReturnType<typeof setTimeout> | undefined, checking = false, closed = false;
    const flush = async () => {
      timer = undefined;
      if (closed || checking || !pending.size) return;
      checking = true;
      const batch = [...pending.values()]; pending.clear();
      try {
        const current = await auth(req);
        if (current.actor.userId !== userId || current.actor.membershipKey !== initial.actor.membershipKey) throw new MessageFailure(403);
        if (!closed) for (const change of batch) reply.raw.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
      } catch { reply.raw.end(); }
      finally { checking = false; if (!closed && pending.size && !timer) timer = setTimeout(() => void flush(), 100); }
    };
    const unsubscribe = workspaceEvents.subscribe(event => {
      if (event && event.target !== target && event.target !== memberTarget && !([`profile:${userId}`, `organization:${initial.actor.organizationId}`].includes(event.target) && event.kind === 'profiles') && !(event.target === '*' && event.kind === 'profiles')) return;
      const change = event ? { kind: event.kind, ...([`profile:${userId}`, `organization:${initial.actor.organizationId}`].includes(event.target) ? {selfProfile:true} : {}), ...(event.conversationId ? { conversationId: event.conversationId } : {}) } : { kind: 'resync' as const };
      pending.set(`${change.kind}:${'conversationId' in change ? change.conversationId ?? '' : ''}:${'selfProfile' in change ? 'self' : ''}`, change);
      if (!timer && !checking) timer = setTimeout(() => void flush(), 100);
    });
    // Stay below the API's 10-second idle socket timeout without reading data.
    const keepalive = setInterval(() => { if (!closed) reply.raw.write(': heartbeat\n\n'); }, 5000);
    // Existing edge stream limit is 60 seconds; reconnect reauthorizes and catches up.
    const expiry = setTimeout(() => reply.raw.end(), 55000);
    reply.raw.on('close', () => { closed = true; unsubscribe(); clearTimeout(timer); clearTimeout(expiry); clearInterval(keepalive); pending.clear(); });
  });
  app.get(prefix + "/preview", async (req) => {
    await auth(req);
    const { url } = z
      .object({ url: z.url().max(2048) })
      .strict()
      .parse(req.query);
    return linkPreview(url);
  });
  app.get(prefix + "/search", async req => {
    const a=await auth(req), q=globalSearchInput.parse(req.query);
    const addresses=(await accessibleInboxes(a)).filter(address=>q.inbox==="all"||(q.inbox==="mine"?address.kind==="user":address.kind==="group"&&address.id===q.inbox));
    if (!addresses.length) throw new MessageFailure(403);
    const hits=[];
    for(const address of addresses) hits.push(...await a.store.search(a.actor,address,q));
    const unique=[...new Map(hits.map(hit=>[hit.key,hit])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||(a.key<b.key?1:a.key>b.key?-1:0));
    const results=unique.slice(0,30),last=results.at(-1);
    return {results,next:unique.length>30&&last?{beforeDate:last.createdAt,beforeKey:last.key}:null,companies:[],senders:[]};
  });
  app.get(prefix + "/phonebook",async req=>{
    const a=await auth(req);
    return {contacts:z.array(personalContact).parse(await a.store.personalContacts(a.actor,await inbox(a)))};
  });
  app.post(prefix + "/phonebook",async req=>{
    const a=await auth(req),body=z.object({id:z.uuid(),contact:personalContactInput}).strict().parse(req.body);
    if(body.contact.company && body.contact.name.toLowerCase()===body.contact.company.toLowerCase())throw new MessageFailure(400);
    return {contact:personalContact.parse(await a.store.savePersonalContact(a.actor,await inbox(a),body.id,body.contact))};
  });
  app.get(prefix + "/search-options", async req => {
    const a=await auth(req), companies=new Map(),senders=new Map();
    for(const address of await accessibleInboxes(a)) {
      const options=await a.store.searchOptions(a.actor,address);
      options.companies.forEach(v=>companies.set(v.id,v));
      options.senders.forEach(v=>senders.set(v.id,v));
    }
    return {companies:[...companies.values()].sort((a,b)=>a.name.localeCompare(b.name)),senders:[...senders.values()].sort((a,b)=>a.name.localeCompare(b.name))};
  });
  app.patch(prefix + "/:conversationId/name", async req => {
    const a = await auth(req), q = query.strict().parse(req.query);
    const body = z.object({ title: z.string().trim().max(200) }).strict().parse(req.body);
    return a.store.rename(a.actor, await inbox(a, q.groupId), params(req).conversationId!, body.title);
  });
  app.get(prefix + "/:conversationId/shared-media",async req=>{
    const a=await auth(req),q=z.object({groupId:z.uuid().optional(),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(req.query);
    return a.store.sharedMedia(a.actor,await inbox(a,q.groupId),params(req).conversationId!,q.offset);
  });
  app.get(prefix + "/:conversationId/participants", async req => {
    const a=await auth(req), q=query.strict().parse(req.query);
    return a.store.participants(a.actor,await inbox(a,q.groupId),params(req).conversationId!);
  });
  app.post(prefix + "/:conversationId/save-contact",async req=>{
    const a=await auth(req),q=query.strict().parse(req.query);
    const body=z.object({id:z.uuid(),organizationId:z.uuid()}).strict().parse(req.body);
    const conversationId=params(req).conversationId!,source=await inbox(a,q.groupId);
    const target=await a.store.directTarget(a.actor,source,conversationId,body.organizationId,body.id);
    if(target.organizationId===a.actor.organizationId)throw new MessageFailure(400);
    const personal=await inbox(a),contacts=await a.store.personalContacts(a.actor,personal);
    const existing=contacts.find(c=>c.sourcePersonId===target.id&&c.sourceOrganizationId===target.organizationId);
    if(existing)return {contact:personalContact.parse(existing)};
    const data=personalContactInput.parse({name:target.name,company:target.organizationName,sourceConversationId:conversationId,sourcePersonId:target.id,sourceOrganizationId:target.organizationId,...(q.groupId?{sourceGroupId:q.groupId}:{})});
    return {contact:personalContact.parse(await a.store.savePersonalContact(a.actor,personal,randomUUID(),data))};
  });
  app.post(prefix + "/:conversationId/direct", async req => {
    const a=await auth(req),q=query.strict().parse(req.query);
    const body=z.object({id:z.uuid(),organizationId:z.uuid()}).strict().parse(req.body);
    const target=await a.store.directTarget(a.actor,await inbox(a,q.groupId),params(req).conversationId!,body.organizationId,body.id);
    return {conversation:await a.store.create(a.actor,await inbox(a),target)};
  });
  app.post(prefix + "/:conversationId/participants", async req => {
    const a=await auth(req),q=query.strict().parse(req.query),body=addParticipantsInput.parse(req.body);
    const sender=await inbox(a,q.groupId),id=params(req).conversationId!;
    await a.store.detail(a.actor,sender,id);
    const targets=await Promise.all(body.targets.map(target=>options.directory.resolve(a.token,a.actor.organizationId,target)));
    return a.store.addParticipants(a.actor,sender,id,targets,body.history,body.convertExternal);
  });
  app.post(prefix + "/:conversationId/participants/review", async req => {
    const a=await auth(req),q=query.strict().parse(req.query);
    const body=z.object({requestId:z.uuid(),approve:z.boolean()}).strict().parse(req.body);
    return a.store.decideParticipant(a.actor,await inbox(a,q.groupId),params(req).conversationId!,body.requestId,body.approve);
  });
  app.post(prefix + "/:conversationId/participants/depart", async req => {
    const a=await auth(req), q=query.strict().parse(req.query);
    const body=z.object({targetId:z.uuid(),nextOwnerId:z.uuid().optional()}).strict().parse(req.body);
    return a.store.depart(a.actor,await inbox(a,q.groupId),params(req).conversationId!,body.targetId,body.nextOwnerId);
  });
  app.get(prefix + "/company-groups", async req=>{
    const a = await auth(req);
    const groups = await a.store.companyGroups(a.actor, await inbox(a));
    // Group membership stores a historical label; IAM owns current profile names.
    const names = new Map([[a.actor.userId, a.actor.name]]);
    const remaining = new Set(groups.flatMap(g => g.members.map(m => m.id)));
    remaining.delete(a.actor.userId);
    let offset: number | null = 0;
    while (remaining.size && offset !== null) {
      const page = await options.directory.search(a.token, a.actor.organizationId, "", offset);
      for (const person of page.people) {
        if (person.kind === "user" && person.organizationId === a.actor.organizationId) {
          names.set(person.id, person.name);
          remaining.delete(person.id);
        }
      }
      if (page.nextOffset !== null && (page.nextOffset <= offset || page.nextOffset > 100000))
        throw new MessageFailure(503);
      offset = page.nextOffset;
    }
    return { groups: groups.map(g => ({ ...g, members: g.members.map(m => ({
      ...m, name: names.get(m.id) ?? "Unavailable member",
    })) })) };
  });
  app.post(prefix + "/team/from-group", async req=>{
    const a=await auth(req),body=z.object({groupId:z.uuid()}).strict().parse(req.body),sender=await inbox(a);
    const group=(await a.store.companyGroups(a.actor,sender)).find(g=>g.id===body.groupId);
    if(!group)throw new MessageFailure(404);
    const ids=[...new Set(group.members.map(m=>m.id))].filter(id=>id!==a.actor.userId);
    if(!ids.length || ids.length>99)throw new MessageFailure(400);
    const recipients=await Promise.all(ids.map(id=>options.directory.resolve(a.token,a.actor.organizationId,{id,organizationId:a.actor.organizationId})));
    return {conversation:recipients.length===1?await a.store.create(a.actor,sender,recipients[0]!):await a.store.team(a.actor,sender,recipients,"")};
  });
  app.post(prefix + "/team", async (req) => {
    const a = await auth(req),
      body = teamConversation.parse(req.body);
    const sender = await inbox(a);
    const recipients = await Promise.all(
      [...new Set(body.recipients)].map((id) =>
        options.directory.resolve(a.token, a.actor.organizationId, {
          id,
          organizationId: a.actor.organizationId,
        }),
      ),
    );
    return {
      conversation: await a.store.team(a.actor, sender, recipients, body.title),
    };
  });
  app.patch(
    prefix + "/:conversationId/messages/:messageId",
    { bodyLimit: 500000 },
    async (req) => {
      const a = await auth(req),
        q = query.strict().parse(req.query),
        p = params(req);
      return a.store.edit(
        a.actor,
        await inbox(a, q.groupId),
        p.conversationId!,
        p.messageId!,
        editMessage.parse(req.body),
      );
    },
  );
  app.delete(prefix + "/:conversationId/messages/:messageId", async (req) => {
    const a = await auth(req),
      q = query.strict().parse(req.query),
      p = params(req);
    return a.store.remove(
      a.actor,
      await inbox(a, q.groupId),
      p.conversationId!,
      p.messageId!,
    );
  });
  app.post(
    prefix + "/:conversationId/messages/:messageId/reactions",
    async (req) => {
      const a = await auth(req),
        q = query.strict().parse(req.query),
        p = params(req);
      const body = z
        .object({ emoji: z.enum(["👍", "❤️", "😂", "🎉", "😮", "😢"]) })
        .strict()
        .parse(req.body);
      return a.store.react(
        a.actor,
        await inbox(a, q.groupId),
        p.conversationId!,
        p.messageId!,
        body.emoji,
      );
    },
  );
  app.post(prefix + "/:conversationId/typing", async (req) => {
    const a = await auth(req),
      q = query.strict().parse(req.query),
      p = params(req);
    const result = await a.store.typing(
      a.actor,
      await inbox(a, q.groupId),
      p.conversationId!,
      z.object({ active: z.boolean() }).strict().parse(req.body).active,
    );
    groupIdentityChanged(`typing:${p.conversationId!}`);
    return result;
  });
  app.post(prefix + "/:conversationId/attachments", async (req) => {
    const a = await auth(req),
      q = query.strict().parse(req.query),
      p = params(req);
    return a.store.reserve(
      a.actor,
      await inbox(a, q.groupId),
      p.conversationId!,
      attachmentInput.parse(req.body),
    );
  });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.put(
    prefix + "/:conversationId/attachments/:attachmentId",
    { bodyLimit: 26214400 },
    async (req) => {
      const a = await auth(req),
        q = query.strict().parse(req.query),
        p = params(req);
      return a.store.upload(
        a.actor,
        await inbox(a, q.groupId),
        p.conversationId!,
        p.attachmentId!,
        req.body as Buffer,
        String(req.headers["x-file-type"] ?? ""),
      );
    },
  );
  app.post(
    prefix + "/:conversationId/attachments/:attachmentId/complete",
    async (req) => {
      const a = await auth(req),
        q = query.strict().parse(req.query),
        p = params(req);
      return a.store.complete(
        a.actor,
        await inbox(a, q.groupId),
        p.conversationId!,
        p.attachmentId!,
      );
    },
  );
  app.post(
    prefix + "/:conversationId/attachments/:attachmentId/url",
    async (req) => {
      const a = await auth(req),
        q = query.strict().parse(req.query),
        p = params(req);
      await a.store.authorizeMedia(
        a.actor,
        await inbox(a, q.groupId),
        p.conversationId!,
        p.attachmentId!,
      );
      const signed = mediaSignature(
        `${a.actor.userId}:${a.actor.organizationId}:${q.groupId ?? ""}:${p.conversationId}:${p.attachmentId}`,
      );
      return {
        url: `/v1/organizations/${p.organizationId}/messaging/${p.conversationId}/attachments/${p.attachmentId}?${new URLSearchParams({ ...(q.groupId ? { groupId: q.groupId } : {}), expires: String(signed.expires), signature: signed.signature })}`,
        expires: signed.expires,
      };
    },
  );
  // Local media remains authenticated on every fetch; no public storage URL.
  app.get(
    prefix + "/:conversationId/attachments/:attachmentId",
    async (req, reply) => {
      const a = await auth(req),
        q = query
          .extend({ expires: z.coerce.number().int(), signature: z.string() })
          .strict()
          .parse(req.query),
        p = params(req);
      if (
        !validMediaSignature(
          `${a.actor.userId}:${a.actor.organizationId}:${q.groupId ?? ""}:${p.conversationId}:${p.attachmentId}`,
          q.expires,
          q.signature,
        )
      )
        throw new MessageFailure(403);
      const file = await a.store.media(
        a.actor,
        await inbox(a, q.groupId),
        p.conversationId!,
        p.attachmentId!,
      );
      const bytes = Buffer.from(file.data);
      reply
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("Accept-Ranges", "bytes")
        .type(file.mime);
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        const start = match ? Number(match[1]) : -1,
          end = match?.[2] ? Number(match[2]) : bytes.length - 1;
        if (
          start < 0 ||
          start >= bytes.length ||
          end < start ||
          end >= bytes.length
        )
          return reply
            .code(416)
            .header("Content-Range", `bytes */${bytes.length}`)
            .send();
        return reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
          .send(bytes.subarray(start, end + 1));
      }
      return reply.send(bytes);
    },
  );
  app.get(prefix + "/badges", async req => {
    const a = await auth(req);
    const ids = await mapInboxes(await accessibleInboxes(a), address => a.store.unreadMessages(a.actor, address));
    return { messages: Math.min(100, new Set(ids.flat()).size) };
  });
  app.get(prefix + "/presence", async req => {
    const a = await auth(req);
    const q = query.extend({ids:z.string().max(40000)}).strict().parse(req.query);
    const ids = z.array(z.uuid()).max(1000).parse(JSON.parse(q.ids));
    return {statuses:await a.store.presence(a.actor,await inbox(a,q.groupId),ids)};
  });
  app.get(prefix + "/typing", async req => {
    const a = await auth(req);
    const { watch } = z.object({ watch: z.string().max(16000) }).strict().parse(req.query);
    const items = z.array(z.object({ id: z.uuid(), groupId: z.uuid().optional() }).strict()).max(100).parse(JSON.parse(watch));
    return { statuses: await mapInboxes(items, async item => {
      try { return { id: item.id, people: await a.store.typingStatus(a.actor, await inbox(a,item.groupId),item.id) }; }
      catch { return { id: item.id, people: [] }; }
    }) };
  });
  app.get(prefix + "/inboxes", async (req) => {
    const a = await auth(req),
      addresses = await accessibleInboxes(a);
    const summaries = await mapInboxes(addresses, async address => ({
      id: address.kind === "group" ? address.id : "",
      name: address.kind === "group" ? address.name : "My chats",
      ...await a.store.unreadOverview(a.actor,address),
    }));
    return {inboxes:summaries.map(({ids,...row})=>row),messages:Math.min(100,new Set(summaries.flatMap(s=>s.ids)).size)};
  });

  app.get(prefix + "/feed", async (req) => {
    const a = await auth(req);
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        filter: z.enum(["all", "unread", "done", "any"]).default("all"),
        search: z.string().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    const addresses = await accessibleInboxes(a);
    const rows: Awaited<ReturnType<MessagingStore["list"]>>["conversations"] = [];
    let more = false;
    // Merge independently authorized inbox pages. Notes remain scoped to each
    // inbox transaction; never widen RLS to build a combined feed.
    await mapInboxes(addresses, async address => {
      let offset: number | null = 0;
      while (offset !== null && offset <= q.offset + 30) {
        const page = await a.store.list(
          a.actor,
          address,
          offset,
          q.filter,
          q.search,
        );
        rows.push(...page.conversations);
        offset = page.nextOffset;
      }
      more ||= offset !== null;
    });
    rows.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    );
    return {
      conversations: rows.slice(q.offset, q.offset + 30),
      nextOffset: more || rows.length > q.offset + 30 ? q.offset + 30 : null,
    };
  });
  app.get(prefix + "/people", async (req) => {
    const a = await auth(req);
    const q = z
      .object({
        groupId: z.uuid().optional(),
        search: z.string().max(254).default(""),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .parse(req.query);
    const result = await options.directory.search(
      a.token,
      a.actor.organizationId,
      q.search,
      q.offset,
    );
    const groupId = query.parse(req.query).groupId;
    if (groupId) await inbox(a, groupId);
    return {
      ...result,
      people: result.people.filter((p) =>
        groupId
          ? p.organizationId !== a.actor.organizationId
          : p.id !== a.actor.userId ||
            p.organizationId !== a.actor.organizationId,
      ),
    };
  });
  app.get(prefix + "/assignees", async (req) => {
    const a = await auth(req);
    const q = z.object({ groupId: z.uuid() }).strict().parse(req.query);
    await inbox(a, q.groupId);
    const detail = await a.groups.detail(
      { ...a.actor, organizationName: a.organizationName },
      q.groupId,
    );
    return {
      members: detail.members.map((m) => ({ id: m.user_id, name: m.name })),
    };
  });
  app.get(prefix, async (req) => {
    const a = await auth(req);
    const q = query
      .extend({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        filter: z.enum(["all", "unread", "done"]).default("all"),
        search: z.string().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    return a.store.list(
      a.actor,
      await inbox(a, q.groupId),
      q.offset,
      q.filter,
      q.search,
    );
  });
  app.post(prefix, async (req) => {
    const a = await auth(req),
      input = createConversation.parse(req.body);
    const sender = await inbox(a, input.groupId);
    if (
      input.target.organizationId === sender.organizationId &&
      (sender.kind === "group" || input.target.kind === "group")
    )
      throw new MessageFailure(400);
    let target: Address;
    if (input.target.kind === "user") {
      target = await options.directory.resolve(
        a.token,
        a.actor.organizationId,
        input.target,
      );
    } else {
      const g = await a.groups.published(
        { ...a.actor, organizationName: a.organizationName },
        input.target.organizationId,
        input.target.id,
      );
      const active = await options.eligibility.active(
        a.token,
        a.actor.organizationId,
        [g.organization_id],
      );
      if (!active.includes(g.organization_id)) throw new MessageFailure(403);
      target = {
        kind: "group",
        id: g.id,
        organizationId: g.organization_id,
        name: g.name,
        organizationName: g.organization_name,
      };
    }
    return { conversation: await a.store.create(a.actor, sender, target) };
  });
  app.get(prefix + "/:conversationId", async (req) => {
    const a = await auth(req),
      q = query.strict().parse(req.query);
    return {
      conversation: await a.store.detail(
        a.actor,
        await inbox(a, q.groupId),
        params(req).conversationId!,
      ),
    };
  });
  app.get(prefix + "/typing-events", async (req,reply)=>{
    await auth(req);
    const q=z.object({watch:z.string().max(16000)}).strict().parse(req.query);
    const watch=z.array(z.object({id:z.uuid(),groupId:z.uuid().optional()}).strict()).max(100).parse(JSON.parse(q.watch));
    reply.hijack();
    reply.raw.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store","X-Accel-Buffering":"no"});
    reply.raw.write("retry: 1000\n\n");
    let running=false,pending=false;
    const update=async()=>{
      if(running){pending=true;return;}
      if(reply.raw.destroyed)return;
      running=true;
      try {
        const a=await auth(req);
        const statuses=await mapInboxes(watch,async item=>{
          try {return {id:item.id,people:await a.store.typingStatus(a.actor,await inbox(a,item.groupId),item.id)};}
          catch {return {id:item.id,people:[]};}
        });
        if(!reply.raw.destroyed)reply.raw.write(`event: typing\ndata: ${JSON.stringify(statuses)}\n\n`);
      } catch {reply.raw.end();}
      finally {running=false;if(pending){pending=false;void update();}}
    };
    const unsubscribe=onGroupIdentityChanged(watch.map(v=>`typing:${v.id}`),()=>void update());
    const fallback=setInterval(()=>void update(),60000);
    const timeout=setTimeout(()=>reply.raw.end(),55000);
    reply.raw.on("close",()=>{unsubscribe();clearInterval(fallback);clearTimeout(timeout);});
    void update();
  });
  app.get(prefix + "/:conversationId/identity-events", async (req, reply) => {
    const a = await auth(req),
      q = query.strict().parse(req.query);
    const address = await inbox(a, q.groupId),
      id = params(req).conversationId!;
    const conversation = await a.store.detail(a.actor, address, id);
    const ids = [conversation.inbox, conversation.peer]
      .filter((p) => p.kind === "group")
      .map((p) => p.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 2000\n\n");
    let checking = false;
    const unsubscribe = onGroupIdentityChanged([...ids, id], () => {
      if (checking || reply.raw.destroyed) return;
      checking = true;
      void (async () => {
        try {
          const current = await auth(req);
          await current.store.detail(
            current.actor,
            await inbox(current, q.groupId),
            id,
          );
          if (!reply.raw.destroyed)
            reply.raw.write("event: identity\ndata: {}\n\n");
        } catch {
          reply.raw.end();
        } finally {
          checking = false;
        }
      })();
    });
    // Reconnect and reauthorize even when no group settings change.
    const timer = setTimeout(() => reply.raw.end(), 55000);
    timer.unref();
    reply.raw.on("close", () => {
      clearTimeout(timer);
      unsubscribe();
    });
  });
  // One fresh authorization for the selected conversation refresh. Each store
  // operation still uses its own inbox-scoped RLS transaction.
  app.get(prefix + "/:conversationId/snapshot", async req => {
    const a = await auth(req), q = query.extend({after:z.coerce.number().int().min(0).optional(),oldest:z.coerce.number().int().min(0).default(0)}).strict().parse(req.query);
    const address = await inbox(a, q.groupId), id = params(req).conversationId!;
    const [conversation, messages] = await Promise.all([
      a.store.detail(a.actor, address, id),
      a.store.messages(a.actor, address, id, Number.MAX_SAFE_INTEGER, q.after === undefined ? undefined : {after:q.after,oldest:q.oldest}),
    ]);
    return { conversation, ...messages };
  });
  app.get(prefix + "/:conversationId/messages", async (req) => {
    const a = await auth(req),
      q = query
        .extend({
          before: z.coerce
            .number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER)
            .default(Number.MAX_SAFE_INTEGER),
        })
        .strict()
        .parse(req.query);
    return a.store.messages(
      a.actor,
      await inbox(a, q.groupId),
      params(req).conversationId!,
      q.before,
    );
  });
  app.post(
    prefix + "/:conversationId/messages",
    { bodyLimit: 500000 },
    async (req) => {
      const a = await auth(req),
        q = query.strict().parse(req.query);
      return a.store.send(
        a.actor,
        await inbox(a, q.groupId),
        params(req).conversationId!,
        sendMessage.parse(req.body),
      );
    },
  );
  app.post(prefix + "/:conversationId/read", async (req) => {
    const a = await auth(req),
      q = query.strict().parse(req.query),
      body = z
        .object({
          sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        })
        .strict()
        .parse(req.body);
    return a.store.read(
      a.actor,
      await inbox(a, q.groupId),
      params(req).conversationId!,
      body.sequence,
    );
  });
  app.patch(prefix + "/:conversationId", async (req) => {
    const a = await auth(req),
      q = query.strict().parse(req.query),
      body = updateConversation.parse(req.body);
    const address = await inbox(a, q.groupId);
    let name: string | null = null;
    if (body.assignedTo) {
      if (!q.groupId) throw new MessageFailure(400);
      const details = await a.groups.detail(
        { ...a.actor, organizationName: a.organizationName },
        q.groupId,
      );
      const member = details.members.find((m) => m.user_id === body.assignedTo);
      if (!member) throw new MessageFailure(403);
      const current = await options.directory.resolve(
        a.token,
        a.actor.organizationId,
        { organizationId: a.actor.organizationId, id: body.assignedTo },
      );
      if (current.membershipKey !== member.membership_key)
        throw new MessageFailure(403);
      name = current.name;
    }
    return {
      conversation: await a.store.update(
        a.actor,
        address,
        params(req).conversationId!,
        body,
        name,
      ),
    };
  });
}
