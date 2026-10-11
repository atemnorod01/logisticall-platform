import { searchInbox } from "./message-search.js";
import type { MediaStorage } from "./media-storage.js";
import type { GlobalSearchInput, GlobalSearchHit } from "../../../packages/types/src/messaging.js";
import { departGroup, addParticipants, decideParticipant, participantDetails, conversationShape, endpoints, type ParticipantRow } from "./conversation-participants.js";
import { DOCX, XLSX, validateOffice } from "../../../packages/types/src/attachment-formats.js";
import { cleanMessageRich } from "./message-rich.js";
import {
  aggregatePresence,
  type PresenceStore,
  type PresenceStatus,
} from "./presence.js";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Address,
  Conversation,
  Message,
} from "../../../packages/types/src/messaging.js";
export type MessageActor = {
  userId: string;
  organizationId: string;
  membershipKey: string;
  name: string;
};
export class MessageFailure extends Error {
  constructor(public statusCode: number) {
    super("Messaging request rejected");
  }
}
export const addressKey = (a: Address) =>
  [a.organizationId, a.kind, a.id, a.membershipKey ?? ""].join(":");
export type MessagingStore = ReturnType<typeof postgresMessaging>;
export function postgresMessaging(
  pool: Pick<Pool, "connect">,
  presence?: Pick<PresenceStore, "read">,
  storage?: MediaStorage,
) {
  async function enrich(
    c: PoolClient,
    row: Conversation,
    endpoint: Address,
  ): Promise<Conversation> {
    const result = await c.query(
      "select platform.messaging_peer_profile($1,$2::jsonb) as profile",
      [row.id, JSON.stringify(endpoint)],
    );
    const profile = result.rows[0]?.profile;
    if (!profile) return row;
    let status: PresenceStatus = "unknown";
    if (presence) {
      try {
        const ids: string[] = profile.userIds ?? [];
        const values = await presence.read(endpoint.organizationId, ids);
        status = aggregatePresence(ids.map((id) => values[id] ?? "offline"));
      } catch {
        /* An unavailable presence service is not evidence of offline members. */
      }
    }
    return {
      ...row,
      peer: { ...row.peer, name: profile.name },
      identity: {
        contactName: profile.contactName,
        presence: status,
        dot: profile.dot,
        mc: profile.mc,
        inNetwork: profile.inNetwork,
      },
    };
  }

  async function transaction<T>(
    a: MessageActor,
    inbox: Address,
    work: (c: PoolClient) => Promise<T>,
  ) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(
        "select set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true),set_config('app.membership_key',$3,true),set_config('app.messaging_inbox',$4,true)",
        [a.organizationId, a.userId, a.membershipKey, JSON.stringify(inbox)],
      );
      const result = await work(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  const publicAddress = (a: Address) => {
    const { membershipKey: _, ...value } = a;
    return value;
  };
  async function get(c: PoolClient, id: string, inbox: Address, lock = false, history = false) {
    const r = await c.query(
      `select *,platform.messaging_selected_access(a,b,participants) as selected_access from platform.conversations where id=$1 ${lock ? "for update" : ""}`,
      [id],
    );
    const row = r.rows[0];
    if (
      !row || !row.selected_access ||
      ![
        addressKey(row.a),
        addressKey(row.b),
        ...(row.participants ?? []).map(addressKey),
      ].includes(addressKey(inbox))
    )
      throw new MessageFailure(404);
    if (!history && row.departures?.[addressKey(inbox)]) throw new MessageFailure(403);
    return row as ParticipantRow;
  }
  async function audit(
    c: PoolClient,
    a: MessageActor,
    id: string,
    action: string,
  ) {
    await c.query(
      "insert into platform.message_audit(conversation_id,actor_id,organization_id,action) values($1,$2,$3,$4)",
      [id, a.userId, a.organizationId, action],
    );
  }
  async function summary(
    c: PoolClient,
    a: MessageActor,
    row: ParticipantRow,
    inbox: Address,
  ): Promise<Conversation> {
    const key = addressKey(inbox);
    const {team, external, own, peer} = conversationShape(row,inbox);
    const state = await c.query(
      "select s.*, (s.done and not exists(select 1 from platform.messages m where m.conversation_id=s.conversation_id and not m.internal and m.sequence>s.resolved_sequence)) as effective_done from platform.conversation_state s where conversation_id=$1 and address_key=$2",
      [row.id, key],
    );
    // RLS hides notes belonging to the opposite inbox before preview/unread calculation.
    const messages = await c.query(
      `select body,created_at,internal,reply_to,deleted_at,actor_id,actor_name from platform.messages where conversation_id=$1 order by sequence desc limit 1`,
      [row.id],
    );
    const unread = await c.query(
      `select count(*)::int as n from platform.messages m where conversation_id=$1 and actor_id<>$2 and sequence>coalesce((select last_sequence from platform.conversation_reads where conversation_id=$1 and address_key=$3 and user_id=$2),0)`,
      [row.id, a.userId, key],
    );
    const s = state.rows[0];
    const last = messages.rows[0];
    const result: Conversation = {
      id: row.id,
      kind: team ? "team" : "direct",
      external,
      title: row.title,
      readOnly: !!row.departures?.[addressKey(inbox)],
      systemEvents: row.participant_events.filter((e: {sequence:number;createdAt:string})=>e.sequence>=Number(row.history_limits[addressKey(inbox)]??0) && (!row.departures?.[addressKey(inbox)] || e.createdAt<=row.departures[addressKey(inbox)]!.leftAt)),
      participants: endpoints(row).map(publicAddress),
      hasMessages: Boolean(last),
      inbox: publicAddress(own),
      peer: publicAddress(peer),
      updatedAt: (last?.created_at ?? row.created_at).toISOString(),
      preview: last
        ? `${last.actor_id === a.userId ? "You" : last.actor_name}: ` +
          (last.deleted_at ? "This message has been deleted." :
            (last.internal ? (last.reply_to ? "Internal comment: " : "Internal note: ") : "") +
            (last.body.slice(0, 200) || "Attachment"))
        : "No messages yet",
      unread: row.departures?.[addressKey(inbox)] ? 0 : unread.rows[0].n,
      done: s?.effective_done ?? false,
      assignedTo: s?.assigned_to ?? null,
      assignedName: s?.assigned_name ?? null,
      version: s?.version ?? 1,
    };
    return team ? result : enrich(c, result, peer);
  }
  return {
    search(a: MessageActor, inbox: Address, input: GlobalSearchInput) {
      return transaction(a,inbox,async c => {
        const found = await searchInbox(c,input);
        const summaries = new Map<string,Conversation>();
        const results: GlobalSearchHit[] = [];
        for (const hit of found.rows) {
          if (!summaries.has(hit.conversation_id)) summaries.set(hit.conversation_id,await summary(c,a,await get(c,hit.conversation_id,inbox,false,true),inbox));
          results.push({key:hit.key,kind:hit.kind,conversation:summaries.get(hit.conversation_id)!,messageId:hit.parent_id??hit.message_id,commentId:hit.parent_id?hit.message_id:null,author:hit.author,authorId:hit.author_id,text:hit.text,createdAt:hit.created_at.toISOString(),internal:hit.internal});
        }
        return results;
      });
    },
    searchOptions(a: MessageActor, inbox: Address) {
      return transaction(a,inbox,async c => {
        const companies = await c.query(`select distinct p->>'organizationId' as id,p->>'organizationName' as name from platform.conversations cv cross join lateral jsonb_array_elements(jsonb_build_array(cv.a,cv.b)||cv.participants) p where platform.messaging_selected_access(cv.a,cv.b,cv.participants)`);
        const senders = await c.query("select distinct actor_id as id,actor_name as name from platform.messages where deleted_at is null");
        return {companies:companies.rows,senders:senders.rows};
      });
    },
    rename(a: MessageActor, inbox: Address, id: string, title: string) {
      return transaction(a, inbox, async c => {
        const row = await get(c, id, inbox, true);
        if (!conversationShape(row, inbox).team) throw new MessageFailure(400);
        if (title.trim().length > 200) throw new MessageFailure(400);
        await c.query("update platform.conversations set title=$2,updated_at=now() where id=$1", [id, title.trim()]);
        await audit(c, a, id, "conversation.renamed");
        return { ok: true };
      });
    },
    sharedMedia(a:MessageActor,inbox:Address,id:string,offset:number){
      return transaction(a,inbox,async c=>{
        await get(c,id,inbox,false,true);
        const result=await c.query(`select f.id,f.filename,f.mime,f.size,m.created_at as "sentAt",m.actor_name as sender from platform.message_attachments f join platform.messages m on m.id=f.message_id where f.conversation_id=$1 and f.state='ready' and m.deleted_at is null order by m.sequence desc,f.position,f.id offset $2 limit 31`,[id,offset]);
        return {files:result.rows.slice(0,30),nextOffset:result.rows.length>30?offset+30:null};
      });
    },
    companyGroups(a:MessageActor,inbox:Address) {
      return transaction(a,inbox,async c=>(await c.query(`select g.id,g.name,g.description,coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.member_name) order by m.member_name) filter(where m.user_id is not null),'[]'::jsonb) as members from platform.groups g left join platform.group_members m on m.group_id=g.id and m.organization_id=g.organization_id where g.organization_id=$1 and not g.archived group by g.organization_id,g.id order by g.name`,[a.organizationId])).rows as {id:string;name:string;description:string;members:{id:string;name:string}[]}[]);
    },
    personalContacts(a:MessageActor,inbox:Address) {
      return transaction(a,inbox,async c=>(await c.query("select id,data from platform.personal_contacts order by lower(data->>'name'),id")).rows.map(r=>({...r.data,id:r.id})));
    },
    savePersonalContact(a:MessageActor,inbox:Address,id:string,data:unknown) {
      return transaction(a,inbox,async c=>{
        const r=await c.query("insert into platform.personal_contacts(id,organization_id,user_id,membership_key,data) values($1,$2,$3,$4,$5) on conflict(id) do update set data=excluded.data,updated_at=now() returning id,data",[id,a.organizationId,a.userId,a.membershipKey,JSON.stringify(data)]);
        return {...r.rows[0].data,id:r.rows[0].id};
      });
    },
    directTarget(a:MessageActor,inbox:Address,id:string,organizationId:string,userId:string) {
      return transaction(a,inbox,async c=>{
        await get(c,id,inbox);
        const r=await c.query("select platform.messaging_direct_target($1,$2,$3) as target",[id,organizationId,userId]);
        if(!r.rows[0]?.target)throw new MessageFailure(403);
        return r.rows[0].target as Address;
      });
    },
    participants(a:MessageActor,inbox:Address,id:string){
      return transaction(a,inbox,async c=>participantDetails(c,await get(c,id,inbox,false,true),inbox,a));
    },
    addParticipants(a:MessageActor,inbox:Address,id:string,targets:Address[],history:"all"|"future",convertExternal:boolean){
      return transaction(a,inbox,async c=>{const row=await get(c,id,inbox,true);await addParticipants(c,row,inbox,a,targets,history,convertExternal);await audit(c,a,id,"participants.added_or_requested");return {ok:true};});
    },
    decideParticipant(a:MessageActor,inbox:Address,id:string,requestId:string,approve:boolean){
      return transaction(a,inbox,async c=>{const row=await get(c,id,inbox,true);await decideParticipant(c,row,a,requestId,approve);await audit(c,a,id,"participants.reviewed");return {ok:true};});
    },
    depart(a:MessageActor,inbox:Address,id:string,targetId:string,nextOwnerId?:string) {
      return transaction(a,inbox,async c=>{const row=await get(c,id,inbox,true);await departGroup(c,row,inbox,a,targetId,nextOwnerId);await audit(c,a,id,targetId===a.userId?"group.left":"group.member_removed");return {ok:true};});
    },
    team(
      a: MessageActor,
      sender: Address,
      recipients: Address[],
      title: string,
    ) {
      return transaction(a, sender, async (c) => {
        const participants = [sender, ...recipients];
        if (
          participants.length < 3 || participants.length > 100 ||
          new Set(participants.map(addressKey)).size !== participants.length ||
          participants.some(
            (p) => p.kind !== "user" || p.organizationId !== a.organizationId,
          )
        )
          throw new MessageFailure(400);
        const result = await c.query(
          "insert into platform.conversations(pair_key,a,b,participants,title) values($1,$2,$3,$4,$5) returning *",
          [
            crypto.randomUUID(),
            JSON.stringify(sender),
            JSON.stringify(recipients[0]),
            JSON.stringify(participants),
            title,
          ],
        );
        return summary(c, a, result.rows[0], sender);
      });
    },
    edit(
      a: MessageActor,
      inbox: Address,
      id: string,
      messageId: string,
      input: { body: string; rich: string },
    ) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox);
        const old = (
          await c.query(
            "select * from platform.messages where id=$1 and conversation_id=$2 for update",
            [messageId, id],
          )
        ).rows[0];
        if (!old || old.actor_id !== a.userId || old.deleted_at || old.call_event)
          throw new MessageFailure(403);
        if (
          !input.body.trim() &&
          !(
            await c.query(
              "select 1 from platform.message_attachments where message_id=$1",
              [messageId],
            )
          ).rows.length
        )
          throw new MessageFailure(400);
        await c.query(
          "update platform.messages set body=$2,rich=$3,edited_at=now() where id=$1",
          [messageId, input.body, cleanMessageRich(input.rich)],
        );
        await audit(c, a, id, "message.edited");
        return { ok: true };
      });
    },
    remove(a: MessageActor, inbox: Address, id: string, messageId: string) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox);
        const result = await c.query(
          "update platform.messages set body='',rich='',deleted_at=coalesce(deleted_at,now()) where id=$1 and conversation_id=$2 and actor_id=$3 and call_event is null returning id",
          [messageId, id, a.userId],
        );
        if (!result.rows.length) throw new MessageFailure(403);
        await audit(c, a, id, "message.deleted");
        return { ok: true };
      });
    },
    react(
      a: MessageActor,
      inbox: Address,
      id: string,
      messageId: string,
      emoji: string,
    ) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox, true);
        if (
          !(
            await c.query(
              "select id from platform.messages where id=$1 and conversation_id=$2 and deleted_at is null",
              [messageId, id],
            )
          ).rows.length
        )
          throw new MessageFailure(404);
        const deleted = await c.query(
          "delete from platform.message_reactions where message_id=$1 and user_id=$2 and emoji=$3 returning message_id",
          [messageId, a.userId, emoji],
        );
        if (!deleted.rows.length)
          await c.query(
            "insert into platform.message_reactions values($1,$2,$3)",
            [messageId, a.userId, emoji],
          );
        return { ok: true };
      });
    },
    typingStatus(a:MessageActor,inbox:Address,id:string) {
      return transaction(a,inbox,async c=>{
        await get(c,id,inbox);
        const result=await c.query("select user_id,actor_name,max(expires_at) as expires_at from platform.message_typing where conversation_id=$1 and user_id<>$2 and expires_at>now() group by user_id,actor_name order by actor_name",[id,a.userId]);
        return result.rows.filter(r=>r.actor_name).map(r=>({id:r.user_id,name:r.actor_name,expiresAt:r.expires_at.toISOString()}));
      });
    },
    typing(a: MessageActor, inbox: Address, id: string, active: boolean) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox);
        if (active)
          await c.query(
            "insert into platform.message_typing(conversation_id,user_id,address_key,expires_at,actor_name) values($1,$2,$3,now()+interval '8 seconds',$4) on conflict(conversation_id,user_id,address_key) do update set expires_at=excluded.expires_at,actor_name=excluded.actor_name",
            [id, a.userId, addressKey(inbox), a.name],
          );
        else
          await c.query(
            "delete from platform.message_typing where conversation_id=$1 and user_id=$2 and address_key=$3",
            [id, a.userId, addressKey(inbox)],
          );
        return { ok: true };
      });
    },
    reserve(
      a: MessageActor,
      inbox: Address,
      id: string,
      input: { filename: string; mime: string; size: number },
    ) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox);
        const attachmentId = crypto.randomUUID();
        await c.query(
          "insert into platform.message_attachments(id,conversation_id,owner_id,address_key,filename,mime,size) values($1,$2,$3,$4,$5,$6,$7)",
          [
            attachmentId,
            id,
            a.userId,
            addressKey(inbox),
            input.filename,
            input.mime,
            input.size,
          ],
        );
        return { id: attachmentId, ...input };
      });
    },
    upload(
      a: MessageActor,
      inbox: Address,
      id: string,
      attachmentId: string,
      data: Buffer,
      mime: string,
    ) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox);
        const file = (
          await c.query(
            "select * from platform.message_attachments where id=$1 and conversation_id=$2 and owner_id=$3 and address_key=$4 for update",
            [attachmentId, id, a.userId, addressKey(inbox)],
          )
        ).rows[0];
        if (
          !file ||
          file.state !== "reserved" ||
          file.size !== data.length ||
          file.mime !== mime
        )
          throw new MessageFailure(400);
        // Reject content that contradicts its declared type; never accept active HTML/SVG.
        const head = data.subarray(0, 16),
          ascii = head.toString("latin1");
        const valid =
          mime === DOCX || mime === XLSX
            ? validateOffice(data, mime)
            : mime === "text/plain" || mime === "text/csv"
            ? !data.includes(0)
            : mime === "image/png"
              ? head
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : mime === "image/jpeg"
                ? head[0] === 255 && head[1] === 216 && head[2] === 255
                : mime === "image/gif"
                  ? ascii.startsWith("GIF8")
                  : mime === "image/webp"
                    ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
                    : mime === "application/pdf"
                      ? ascii.startsWith("%PDF-")
                      : mime === "audio/ogg"
                        ? ascii.startsWith("OggS")
                        : mime === "audio/wav"
                          ? ascii.startsWith("RIFF") &&
                            ascii.slice(8, 12) === "WAVE"
                          : (mime === "video/webm" || mime === "audio/webm")
                            ? head
                                .subarray(0, 4)
                                .equals(Buffer.from([26, 69, 223, 163]))
                            : mime.endsWith("/mp4")
                              ? ascii.slice(4, 8) === "ftyp"
                              : mime === "audio/mpeg"
                                ? ascii.startsWith("ID3") ||
                                  (head[0] === 255 && (head[1]! & 224) === 224)
                                : false;
        if (!valid) throw new MessageFailure(415);
        if (storage) {
          await c.query("set local idle_in_transaction_session_timeout='30s'");
          const key = `${id}/${attachmentId}`;
          await storage.put(key, data, mime);
          await c.query("update platform.message_attachments set storage_key=$2,data=null,state='uploaded' where id=$1", [attachmentId,key]);
        } else {
          await c.query("update platform.message_attachments set data=$2,state='uploaded' where id=$1", [attachmentId,data]);
        }
        return { ok: true };
      });
    },
    complete(
      a: MessageActor,
      inbox: Address,
      id: string,
      attachmentId: string,
    ) {
      return transaction(a, inbox, async (c) => {
        await get(c, id, inbox);
        const r = await c.query(
          "update platform.message_attachments set state='ready' where id=$1 and conversation_id=$2 and owner_id=$3 and address_key=$4 and state='uploaded' and (octet_length(data)=size or storage_key is not null) returning id,filename,mime,size",
          [attachmentId, id, a.userId, addressKey(inbox)],
        );
        if (!r.rows.length) throw new MessageFailure(400);
        return r.rows[0];
      });
    },
    async media(a: MessageActor, inbox: Address, id: string, attachmentId: string) {
      const file = await transaction(a, inbox, async (c) => {
        await get(c, id, inbox,false,true);
        const r = await c.query(
          "select data,storage_key,filename,mime,size from platform.message_attachments where id=$1 and conversation_id=$2 and state='ready'",
          [attachmentId, id],
        );
        if (!r.rows[0]) throw new MessageFailure(404);
        return r.rows[0] as {
          data: Buffer;
          storage_key: string | null;
          filename: string;
          mime: string;
          size: number;
        };
      });
      if (file.storage_key) {
        if (!storage) throw new MessageFailure(503);
        file.data = await storage.get(file.storage_key, file.size);
      }
      return file;
    },
    unreadMessages(a: MessageActor, inbox: Address) {
      return transaction(a, inbox, async c => {
        const result = await c.query<{ id: string }>(`select m.id from platform.messages m
          join platform.conversations c on c.id=m.conversation_id
          where not c.departures ? $1 and m.actor_id<>$2 and m.deleted_at is null
          and m.sequence>coalesce((select last_sequence from platform.conversation_reads r
            where r.conversation_id=c.id and r.address_key=$1 and r.user_id=$2),0)
          limit 100`, [addressKey(inbox), a.userId]);
        return result.rows.map(r => r.id);
      });
    },
    unreadCount(a: MessageActor, inbox: Address) {
      return transaction(a, inbox, async (c) => {
        const result = await c.query(
          `select count(*)::int as count from platform.conversations c
          where not c.departures ? $3 and (a @> $1::jsonb or b @> $1::jsonb or participants @> jsonb_build_array($1::jsonb)) and exists (
            select 1 from platform.messages m where m.conversation_id=c.id and m.actor_id<>$2
            and m.sequence>coalesce((select last_sequence from platform.conversation_reads r
              where r.conversation_id=c.id and r.address_key=$3 and r.user_id=$2),0))`,
          [
            JSON.stringify({
              kind: inbox.kind,
              id: inbox.id,
              organizationId: inbox.organizationId,
              ...(inbox.membershipKey
                ? { membershipKey: inbox.membershipKey }
                : {}),
            }),
            a.userId,
            addressKey(inbox),
          ],
        );
        return result.rows[0].count as number;
      });
    },
    create(a: MessageActor, sender: Address, target: Address) {
      return transaction(a, sender, async (c) => {
        if (
          sender.organizationId === target.organizationId &&
          (sender.kind === "group" || target.kind === "group")
        )
          throw new MessageFailure(400);
        if (addressKey(sender) === addressKey(target))
          throw new MessageFailure(400);
        const pair = createHash("sha256")
          .update([addressKey(sender), addressKey(target)].sort().join("|"))
          .digest("hex");
        const r = await c.query(
          "insert into platform.conversations(pair_key,a,b) values($1,$2,$3) on conflict(pair_key) do update set pair_key=excluded.pair_key returning *",
          [pair, JSON.stringify(sender), JSON.stringify(target)],
        );
        await audit(c, a, r.rows[0].id, "conversation.opened");
        return summary(c, a, r.rows[0], sender);
      });
    },
    list(
      a: MessageActor,
      inbox: Address,
      offset: number,
      filter: string,
      search: string,
    ) {
      return transaction(a, inbox, async (c) => {
        const r = await c.query(
          `select c.*, s.assigned_to,s.assigned_name,s.version,
 (coalesce(s.done,false) and coalesce(activity.public_sequence,0)<=s.resolved_sequence) as effective_done,
 last.actor_id as preview_actor,last.actor_name as preview_author,last.deleted_at as preview_deleted,last.body as preview_body,last.internal as preview_internal,last.reply_to as preview_reply_to,last.created_at as preview_at,activity.unread
 from platform.conversations c
 left join platform.conversation_state s on s.conversation_id=c.id and s.address_key=$2
 left join platform.conversation_reads r on r.conversation_id=c.id and r.address_key=$2 and r.user_id=$5
 left join lateral (select body,internal,reply_to,created_at,deleted_at,actor_id,actor_name from platform.messages m where m.conversation_id=c.id order by sequence desc limit 1) last on true
 left join lateral (select count(*) filter(where m.actor_id<>$5 and m.sequence>coalesce(r.last_sequence,0))::int as unread,
 max(m.sequence) filter(where not m.internal) as public_sequence from platform.messages m where m.conversation_id=c.id) activity on true
 where (a @> $1::jsonb or b @> $1::jsonb or participants @> jsonb_build_array($1::jsonb))
 and (last.created_at is not null or c.history_limits ? $2)
 and ($3='' or strpos(lower(concat_ws(' ',a->>'name',b->>'name',a->>'organizationName',b->>'organizationName')),lower($3))>0)
 and ($4='any' or (coalesce(s.done,false) and coalesce(activity.public_sequence,0)<=s.resolved_sequence)=($4='done'))
 and ($4<>'unread' or activity.unread>0)
 order by coalesce(last.created_at,c.updated_at,c.created_at) desc,c.id offset $6 limit 31`,
          [
            JSON.stringify({
              kind: inbox.kind,
              id: inbox.id,
              organizationId: inbox.organizationId,
              ...(inbox.membershipKey
                ? { membershipKey: inbox.membershipKey }
                : {}),
            }),
            addressKey(inbox),
            search,
            filter,
            a.userId,
            offset,
          ],
        );
        const rows: Conversation[] = r.rows.map((row) => {
          const {team,external,own,peer}=conversationShape(row,inbox);
          return {
            kind: team ? "team" : "direct",
            external,
            title: row.title,
            readOnly: !!row.departures?.[addressKey(inbox)],
      systemEvents: row.participant_events.filter((e: {sequence:number;createdAt:string})=>e.sequence>=Number(row.history_limits[addressKey(inbox)]??0) && (!row.departures?.[addressKey(inbox)] || e.createdAt<=row.departures[addressKey(inbox)]!.leftAt)),
      participants: endpoints(row).map(publicAddress),
            id: row.id,
            hasMessages: !!row.preview_at,
            inbox: publicAddress(own),
            peer: publicAddress(peer),
            updatedAt: (row.preview_at ?? row.updated_at ?? row.created_at).toISOString(),
            preview: !row.preview_at ? "Added to conversation" : `${row.preview_actor === a.userId ? "You" : row.preview_author}: ` +
              (row.preview_deleted ? "This message has been deleted." :
                (row.preview_internal ? (row.preview_reply_to ? "Internal comment: " : "Internal note: ") : "") +
                (row.preview_body?.slice(0, 200) || "Attachment")),
            unread: row.departures?.[addressKey(inbox)] ? 0 : row.unread,
            done: row.effective_done ?? false,
            assignedTo: row.assigned_to ?? null,
            assignedName: row.assigned_name ?? null,
            version: row.version ?? 1,
          };
        });
        return {
          conversations: await Promise.all(
            rows
              .slice(0, 30)
              .map((item, i) =>
                item.kind === "team"
                  ? Promise.resolve(item)
                  : enrich(
                      c,
                      item,
                      conversationShape(r.rows[i],inbox).peer,
                    ),
              ),
          ),
          nextOffset: rows.length > 30 ? offset + 30 : null,
        };
      });
    },
    detail(a: MessageActor, inbox: Address, id: string) {
      return transaction(a, inbox, async (c) =>
        summary(c, a, await get(c, id, inbox,false,true), inbox),
      );
    },
    messages(a: MessageActor, inbox: Address, id: string, before: number) {
      return transaction(a, inbox, async (c) => {
        const conversation = await get(c, id, inbox,false,true);
        const identities = await c.query(
          "select platform.messaging_group_identity($1,$2::jsonb) as a,platform.messaging_group_identity($1,$3::jsonb) as b",
          [id, JSON.stringify(conversation.a), JSON.stringify(conversation.b)],
        );
        const identity = (sender: Address) =>
          addressKey(sender) === addressKey(conversation.a)
            ? identities.rows[0].a
            : identities.rows[0].b;
        const r = await c.query(
          "select * from platform.messages where conversation_id=$1 and not (internal and reply_to is not null) and sequence<$2 order by sequence desc limit 51",
          [id, before],
        );
        const sources = await c.query(
          "select id,body,deleted_at from platform.messages where conversation_id=$1 and id=any($2::uuid[])",
          [id, r.rows.map(m => m.reply_to).filter(Boolean)],
        );
        const ids = [...r.rows.map((m) => m.id), ...sources.rows.map(m => m.id)];
        const comments = await c.query(
          "select id,reply_to,sequence,body,actor_name,actor_id,created_at,deleted_at from platform.messages where conversation_id=$1 and internal and reply_to=any($2::uuid[]) order by sequence",
          [id, ids],
        );
        const reactions = await c.query(
          "select message_id,emoji,count(*)::int as count,bool_or(user_id=$2) as mine from platform.message_reactions where message_id=any($1::uuid[]) group by message_id,emoji",
          [ids, a.userId],
        );
        const files = await c.query(
          "select id,message_id,filename,mime,size from platform.message_attachments where message_id=any($1::uuid[]) and state='ready' order by position,id",
          [ids],
        );
        const reads = await c.query(
          "select * from platform.messaging_receipts($1)",
          [id],
        );
        const typing = await c.query(
          "select expires_at from platform.message_typing where conversation_id=$1 and user_id<>$2 and expires_at>now() order by expires_at desc limit 1",
          [id, a.userId],
        );
        const senderPresence = new Map<string, PresenceStatus>();
        if (presence) {
          const organizations = new Map<string, Set<string>>();
          for (const message of r.rows.slice(0, 50)) {
            const org = message.sender.organizationId;
            if (!organizations.has(org)) organizations.set(org, new Set());
            organizations.get(org)!.add(message.actor_id);
          }
          await Promise.all([...organizations].map(async ([org, users]) => {
            try {
              const statuses = await presence.read(org, [...users]);
              for (const user of users) senderPresence.set(`${org}:${user}`, statuses[user] ?? "offline");
            } catch { /* Omit unavailable individual presence. */ }
          }));
        }
        return {
          typing: !conversation.departures?.[addressKey(inbox)] && typing.rows.length > 0,
          typingExpiresAt: typing.rows[0]?.expires_at.toISOString() ?? null,
          identityVersion: JSON.stringify([identities.rows[0],conversation.participants,conversation.history_limits,conversation.departures,conversation.group_owner]),
          hasMore: r.rows.length > 50,
          messages: r.rows
            .slice(0, 50)
            .reverse()
            .map((m): Message => {
              const source = sources.rows.find(v => v.id === m.reply_to);
              const outgoing = m.sender.organizationId === a.organizationId && (conversationShape(conversation,inbox).external || addressKey(m.sender) === addressKey(inbox));
              const policy = identity(m.sender);
              const group = m.sender.kind === "group";
              const show = true; // Public messages always identify their actual author.
              const groupName = policy?.name ?? m.sender.name;
              return {
                id: m.id,
                callEvent: m.call_event ? {...m.call_event,viewerRole: m.call_event.callerId===a.userId ? "caller" : m.call_event.calleeId===a.userId ? "callee" : "observer"} : null,
                internalComments: comments.rows.filter(v => v.reply_to === m.id).map(v => ({
                  id: v.id, sequence: Number(v.sequence), body: v.deleted_at ? "" : v.body,
                  author: v.actor_name, senderKey: v.actor_id, own: v.actor_id === a.userId,
                  createdAt: v.created_at.toISOString(), deletedAt: v.deleted_at?.toISOString() ?? null,
                })),
                sequence: Number(m.sequence),
                body: m.deleted_at ? "" : m.body,
                own: m.actor_id === a.userId,
                senderKey: group && !show ? addressKey(m.sender) : m.actor_id,
                senderPresence: senderPresence.get(`${m.sender.organizationId}:${m.actor_id}`) ?? "unknown",
                rich: m.deleted_at ? "" : cleanMessageRich(m.rich),
                editedAt: m.edited_at?.toISOString() ?? null,
                deletedAt: m.deleted_at?.toISOString() ?? null,
                replyTo: m.reply_to,
                replyPreview: source ? {
                  body: source.deleted_at ? "" : source.body.slice(0, 200),
                  deleted: !!source.deleted_at,
                  attachments: source.deleted_at ? [] : files.rows.filter(v => v.message_id === source.id).map(({id,filename,mime,size}) => ({id,filename,mime,size})),
                } : null,
                threadRoot: m.thread_root,
                forwardedFrom: m.forwarded_from,
                reactions: m.deleted_at
                  ? []
                  : reactions.rows
                      .filter((v) => v.message_id === m.id)
                      .map(({ emoji, count, mine }) => ({
                        emoji,
                        count,
                        mine,
                      })),
                attachments: m.deleted_at
                  ? []
                  : files.rows
                      .filter((v) => v.message_id === m.id)
                      .map(({ id, filename, mime, size }) => ({
                        id,
                        filename,
                        mime,
                        size,
                      })),
                receipts:
                  conversation.a.kind === "user" &&
                  conversation.b.kind === "user"
                    ? (conversation.participants.length
                        ? conversation.participants
                        : [conversation.a, conversation.b]
                      )
                        .filter((p) => p.id !== a.userId)
                        .map((p) => ({
                          name: p.name,
                          read: reads.rows.some(
                            (v) =>
                              v.user_id === p.id &&
                              Number(v.last_sequence) >= Number(m.sequence),
                          ),
                        }))
                    : reads.rows
                        .filter(
                          (v) =>
                            v.user_id !== a.userId &&
                            (!m.internal ||
                              v.address_key === addressKey(inbox)),
                        )
                        .map((_v, i) => ({
                          name: `Participant ${i + 1}`,
                          read: Number(_v.last_sequence) >= Number(m.sequence),
                        })),
                createdAt: m.created_at.toISOString(),
                internal: m.internal,
                outgoing,
                senderName: group
                  ? show
                    ? `${m.actor_name}, ${m.sender.organizationName}, ${groupName}`
                    : `${groupName} at ${m.sender.organizationName}`
                  : m.sender.name,
                actorName: group
                  ? show
                    ? m.actor_name
                    : null
                  : outgoing
                    ? m.actor_name
                    : null,
              };
            }),
        };
      });
    },
    send(
      a: MessageActor,
      inbox: Address,
      id: string,
      input: {
        id: string;
        body: string;
        internal: boolean;
        rich?: string;
        replyTo?: string | null;
        forwardedFrom?: string | null;
        attachments?: string[];
        voicemailFor?: string | undefined;
      },
    ) {
      return transaction(a, inbox, async (c) => {
        const row = await get(c, id, inbox, true);
        const sender = row.participants?.length
          ? row.participants.find((p) => addressKey(p) === addressKey(inbox))!
          : addressKey(row.a) === addressKey(inbox)
            ? row.a
            : row.b;
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              ...input,
              rich: cleanMessageRich(input.rich ?? ""),
            }),
          )
          .digest("hex");
        if (input.internal && sender.kind !== "group" && !input.replyTo)
          throw new MessageFailure(400);
        const old = await c.query(
          "select * from platform.messages where id=$1",
          [input.id],
        );
        if (old.rows[0]) {
          const m = old.rows[0];
          if (
            m.conversation_id !== id ||
            (m.request_hash && m.request_hash !== hash) ||
            m.actor_id !== a.userId ||
            m.body !== input.body ||
            m.internal !== input.internal ||
            addressKey(m.sender) !== addressKey(sender)
          )
            throw new MessageFailure(409);
          return { id: input.id };
        }
        const route = await c.query(
          "select coalesce(bool_and(platform.messaging_route_open(endpoint)),true) as open from jsonb_array_elements($1::jsonb) endpoint",
          [JSON.stringify(endpoints(row).filter(p=>addressKey(p)!==addressKey(sender)))],
        );
        if (!input.internal && !route.rows[0].open)
          throw new MessageFailure(409);
        if (input.voicemailFor) {
          const original = (await c.query("select * from platform.messages where id=$1 and conversation_id=$2 for update",[input.voicemailFor,id])).rows[0];
          if (!original || original.actor_id!==a.userId || original.deleted_at || original.call_event?.outcome!=="unanswered" || addressKey(original.sender)!==addressKey(sender) || input.internal || input.replyTo || input.forwardedFrom) throw new MessageFailure(403);
          if (original.call_event.voicemailId) {
            if (original.call_event.voicemailId!==input.id || original.request_hash!==hash) throw new MessageFailure(409);
            return {id:original.id};
          }
          const attachmentIds = [...new Set(input.attachments ?? [])];
          if (attachmentIds.length!==1) throw new MessageFailure(400);
          const recording = await c.query("select id from platform.message_attachments where id=$1 and conversation_id=$2 and owner_id=$3 and address_key=$4 and state='ready' and message_id is null and mime like 'audio/%'",[attachmentIds[0],id,a.userId,addressKey(inbox)]);
          if (!recording.rows.length) throw new MessageFailure(400);
          await c.query("update platform.messages set call_event=call_event || jsonb_build_object('voicemailId',$2::text),body='Voicemail · unanswered call',request_hash=$3,sequence=default,created_at=now() where id=$1",[original.id,input.id,hash]);
          await c.query("update platform.message_attachments set message_id=$1,position=1 where id=$2",[original.id,attachmentIds[0]]);
          await c.query("update platform.conversations set updated_at=now() where id=$1",[id]);
          await audit(c,a,id,"call.voicemail_sent");
          return {id:original.id};
        }
        let root = null;
        if (input.replyTo) {
          const source = await c.query(
            "select id,thread_root,internal,sender from platform.messages where id=$1 and conversation_id=$2 and deleted_at is null",
            [input.replyTo, id],
          );
          if (!source.rows[0]) throw new MessageFailure(404);
          const parent = source.rows[0];
          if (input.internal && (parent.internal || parent.sender.organizationId === sender.organizationId))
            throw new MessageFailure(400);
          if (!input.internal && parent.internal) throw new MessageFailure(400);
          root = input.internal ? parent.id : parent.thread_root ?? parent.id;
        }
        if (
          input.forwardedFrom &&
          !(
            await c.query(
              "select id from platform.messages where id=$1 and not internal and deleted_at is null",
              [input.forwardedFrom],
            )
          ).rows.length
        )
          throw new MessageFailure(404);
        const attachments = [...new Set(input.attachments ?? [])];
        const media = await c.query(
          "select id from platform.message_attachments where id=any($1::uuid[]) and conversation_id=$2 and owner_id=$3 and state='ready' and message_id is null and address_key=$4",
          [attachments, id, a.userId, addressKey(inbox)],
        );
        if (
          media.rows.length !== attachments.length ||
          (!input.body.trim() && !attachments.length)
        )
          throw new MessageFailure(400);
        await c.query(
          "insert into platform.messages(id,conversation_id,sender,actor_id,actor_name,body,internal,rich,reply_to,thread_root,forwarded_from,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            input.id,
            id,
            JSON.stringify(sender),
            a.userId,
            a.name,
            input.body,
            input.internal,
            cleanMessageRich(input.rich ?? ""),
            input.replyTo ?? null,
            root,
            input.forwardedFrom ?? null,
            hash,
          ],
        );
        await c.query(
          "update platform.message_attachments set message_id=$1,position=array_position($2::uuid[],id) where id=any($2::uuid[])",
          [input.id, attachments],
        );
        await c.query(
          "update platform.conversations set updated_at=now() where id=$1",
          [id],
        );
        await audit(c, a, id, input.internal ? "note.sent" : "message.sent");
        return { id: input.id };
      });
    },
    read(a: MessageActor, inbox: Address, id: string, sequence: number) {
      return transaction(a, inbox, async (c) => {
        const row=await get(c,id,inbox,false,true);
        if(row.departures?.[addressKey(inbox)]) return {ok:true};
        await c.query(
          `insert into platform.conversation_reads values($1,$2,$3,least($4,coalesce((select max(sequence) from platform.messages where conversation_id=$1),0))) on conflict(conversation_id,address_key,user_id) do update set last_sequence=greatest(platform.conversation_reads.last_sequence,excluded.last_sequence)`,
          [id, addressKey(inbox), a.userId, sequence],
        );
        return { ok: true };
      });
    },
    update(
      a: MessageActor,
      inbox: Address,
      id: string,
      input: {
        version: number;
        done?: boolean | undefined;
        assignedTo?: string | null | undefined;
      },
      assignedName: string | null,
    ) {
      return transaction(a, inbox, async (c) => {
        const row = await get(c, id, inbox, true);
        const own = row.participants.length
          ? inbox
          : addressKey(row.a) === addressKey(inbox)
            ? row.a
            : row.b;
        await c.query(
          "insert into platform.conversation_state(conversation_id,address_key,address) values($1,$2,$3) on conflict do nothing",
          [id, addressKey(inbox), JSON.stringify(own)],
        );
        const s = (
          await c.query(
            "select s.*, (s.done and not exists(select 1 from platform.messages m where m.conversation_id=s.conversation_id and not m.internal and m.sequence>s.resolved_sequence)) as effective_done from platform.conversation_state s where conversation_id=$1 and address_key=$2 for update",
            [id, addressKey(inbox)],
          )
        ).rows[0];
        if (s.version !== input.version) throw new MessageFailure(409);
        if (input.assignedTo !== undefined && inbox.kind !== "group")
          throw new MessageFailure(400);
        await c.query(
          "update platform.conversation_state set done=$3,assigned_to=$4,assigned_name=$5,version=version+1,resolved_sequence=case when $3 then coalesce((select max(sequence) from platform.messages where conversation_id=$1),0) else resolved_sequence end where conversation_id=$1 and address_key=$2",
          [
            id,
            addressKey(inbox),
            input.done ?? s.effective_done,
            input.assignedTo === undefined ? s.assigned_to : input.assignedTo,
            input.assignedTo === undefined ? s.assigned_name : assignedName,
          ],
        );
        await audit(c, a, id, "conversation.updated");
        return summary(c, a, row, inbox);
      });
    },
  };
}
