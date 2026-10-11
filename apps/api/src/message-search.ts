import type { PoolClient } from "pg";
import type { GlobalSearchInput } from "../../../packages/types/src/messaging.js";
// Called inside one selected-inbox transaction. Message/attachment RLS retains
// history cutoffs, private-comment boundaries and current group membership.
export async function searchInbox(c: PoolClient, q: GlobalSearchInput) {
  return c.query(`
    with visible as (
      select m.*, coalesce(nullif(cv.title,''),cv.b->>'name') as conversation_name
      from platform.messages m join platform.conversations cv on cv.id=m.conversation_id
      where m.deleted_at is null
        and (not m.internal or m.reply_to is null or exists(select 1 from platform.messages parent where parent.id=m.reply_to and parent.deleted_at is null))
        and ($3::uuid is null or exists(select 1 from jsonb_array_elements(jsonb_build_array(cv.a,cv.b)||cv.participants) p where p->>'organizationId'=$3::text))
        and ($4::uuid is null or m.actor_id=$4)
        and ($5::timestamptz is null or m.created_at >= $5)
        and ($6::timestamptz is null or m.created_at < $6)
    ), hits as (
      select 'm:'||m.id::text as key,'messages' as kind,m.conversation_id,m.id as message_id,
        case when m.internal then m.reply_to end as parent_id,m.actor_name as author,m.actor_id as author_id,m.body as text,m.created_at,m.internal
      from visible m where $2 in ('all','messages') and strpos(lower(m.body),lower($1))>0
      union all
      select 'f:'||f.id::text,'files',m.conversation_id,m.id,case when m.internal then m.reply_to end,m.actor_name,m.actor_id,f.filename,m.created_at,m.internal
      from visible m join platform.message_attachments f on f.message_id=m.id
      where f.state='ready' and $2 in ('all','files') and strpos(lower(f.filename),lower($1))>0
      union all
      (select distinct on (m.conversation_id,m.actor_id) 'p:'||m.conversation_id::text||':'||m.actor_id::text,'people',m.conversation_id,m.id,case when m.internal then m.reply_to end,m.actor_name,m.actor_id,m.body,m.created_at,m.internal
      from visible m where $2 in ('all','people') and strpos(lower(m.actor_name),lower($1))>0
      order by m.conversation_id,m.actor_id,m.created_at desc)
    )
    select * from hits where ($7::timestamptz is null or (date_trunc('milliseconds',created_at),key collate "C") < ($7::timestamptz,$8::text collate "C"))
    order by date_trunc('milliseconds',created_at) desc,key collate "C" desc limit 31
  `,[q.q,q.type,q.company??null,q.sender??null,q.from??null,q.to??null,q.beforeDate??null,q.beforeKey??null]);
}
