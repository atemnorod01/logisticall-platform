create or replace function platform.publish_call_message(call_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c jsonb; convo platform.conversations; sender jsonb; peers jsonb; event jsonb; label text;
begin
 select data into c from platform.audio_calls where id=call_id;
 if c is null or c->>'status'<>'ended' or c->>'conversationId' is null then return; end if;
 select * into convo from platform.conversations where id=(c->>'conversationId')::uuid;
 if not found then return; end if;
 peers=case when jsonb_array_length(convo.participants)>0 then convo.participants else jsonb_build_array(convo.a,convo.b) end;
 select p into sender from jsonb_array_elements(peers) p
 where p->>'organizationId'=c->'caller'->>'organizationId' and
 ((c->>'sourceGroupId' is not null and p->>'kind'='group' and p->>'id'=c->>'sourceGroupId') or
 (c->>'sourceGroupId' is null and p->>'kind'='user' and p->>'id'=c->'caller'->>'id')) limit 1;
 if sender is null then return; end if;
 if not exists(select 1 from jsonb_array_elements(peers) p where
 (p->>'kind'='user' and p->>'id'=c->'callee'->>'id' and p->>'organizationId'=c->'callee'->>'organizationId') or
 (p->>'kind'='group' and p->>'id'=c->'team'->>'id' and p->>'organizationId'=c->'team'->>'organizationId') or
 (p->>'kind'='group' and exists(select 1 from platform.group_members m where m.group_id=(p->>'id')::uuid and m.organization_id=(c->'callee'->>'organizationId')::uuid and m.user_id=(c->'callee'->>'id')::uuid))) then return; end if;
 event=jsonb_build_object('id',call_id,'callerId',c->'caller'->>'id','calleeId',c->'callee'->>'id',
 'callerName',c->'caller'->>'name','calleeName',c->'callee'->>'name',
 'outcome',case when c->>'connectedAt' is not null or c->>'answer' is not null then 'completed' else 'unanswered' end,
 'reason',coalesce(c->>'reason','Call ended'),
 'durationSeconds',case when c->>'connectedAt' is not null then greatest(0,floor(((c->>'endedAt')::numeric-(c->>'connectedAt')::numeric)/1000)) else 0 end);
 label=case when event->>'outcome'='completed' then 'Audio call' else 'Unanswered audio call' end;
 insert into platform.messages(id,conversation_id,sender,actor_id,actor_name,body,call_event,created_at)
 values(call_id,convo.id,sender,(c->'caller'->>'id')::uuid,c->'caller'->>'name',label,event,to_timestamp((c->>'endedAt')::double precision/1000))
 on conflict(id) do nothing;
 update platform.conversations set updated_at=greatest(updated_at,to_timestamp((c->>'endedAt')::double precision/1000)) where id=convo.id;
end $$;
revoke all on function platform.publish_call_message(uuid) from public,anon,authenticated;
grant execute on function platform.publish_call_message(uuid) to platform_group_runtime;

create index if not exists audio_calls_team_recipients on platform.audio_calls using gin ((data->'recipients') jsonb_path_ops);
