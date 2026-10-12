create or replace function platform.sync_profile_name(uid uuid, label text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if uid is null or label is null or length(trim(label))=0 or length(label)>100 then raise exception 'Invalid profile'; end if;
 update platform.group_members set member_name=label where user_id=uid and member_name is distinct from label;
 update platform.conversations set
  a=platform.rename_person_address(a,uid,label), b=platform.rename_person_address(b,uid,label),
  participants=platform.rename_person_address(participants,uid,label),
  participant_requests=platform.rename_person_address(participant_requests,uid,label),
  participant_events=platform.rename_person_address(participant_events,uid,label)
 where a is distinct from platform.rename_person_address(a,uid,label)
    or b is distinct from platform.rename_person_address(b,uid,label)
    or participants is distinct from platform.rename_person_address(participants,uid,label)
    or participant_requests is distinct from platform.rename_person_address(participant_requests,uid,label)
    or participant_events is distinct from platform.rename_person_address(participant_events,uid,label);
 update platform.messages set actor_name=case when actor_id=uid then label else actor_name end,
   sender=platform.rename_person_address(sender,uid,label)
 where (actor_id=uid and actor_name is distinct from label) or sender is distinct from platform.rename_person_address(sender,uid,label);
 update platform.conversation_state set address=platform.rename_person_address(address,uid,label),
   assigned_name=case when assigned_to=uid then label else assigned_name end
 where address is distinct from platform.rename_person_address(address,uid,label) or (assigned_to=uid and assigned_name is distinct from label);
 update platform.personal_contacts set data=jsonb_set(data,'{name}',to_jsonb(label)), updated_at=now() where data->>'sourcePersonId'=uid::text and data->>'name' is distinct from label;
 update platform.message_typing set actor_name=label where user_id=uid and actor_name is distinct from label;
 update platform.audio_calls set data=jsonb_set(data,'{caller,name}',to_jsonb(label)) where data->'caller'->>'id'=uid::text and data->'caller'->>'name' is distinct from label;
 update platform.audio_calls set data=jsonb_set(data,'{callee,name}',to_jsonb(label)) where data->'callee'->>'id'=uid::text and data->'callee'->>'name' is distinct from label;
 update platform.messages set call_event=call_event ||
   case when call_event->>'callerId'=uid::text then jsonb_build_object('callerName',label) else '{}'::jsonb end ||
   case when call_event->>'calleeId'=uid::text then jsonb_build_object('calleeName',label) else '{}'::jsonb end
 where call_event->>'callerId'=uid::text or call_event->>'calleeId'=uid::text;
 update platform.audio_calls set data=jsonb_set(data,'{recipients}',
   (select jsonb_agg(case when p->>'id'=uid::text then p || jsonb_build_object('name',label) else p end order by n)
    from jsonb_array_elements(data->'recipients') with ordinality r(p,n)))
 where data->'recipients' @> jsonb_build_array(jsonb_build_object('id',uid::text));
 -- No identity or profile content in the global invalidation. Every refresh is
 -- authenticated and limited by its existing tenant/resource authorization.
 perform platform.emit_workspace_change('*','profiles');
end $$;
revoke all on function platform.sync_profile_name(uuid,text) from public,anon,authenticated;
grant execute on function platform.sync_profile_name(uuid,text) to platform_group_runtime;

-- Repair existing call display snapshots using already-synchronized identities.
do $$
declare person record;
begin
 for person in
  select distinct on (id) id,label from (
   select user_id as id,member_name as label,0 as priority from platform.group_members
   union all select actor_id,actor_name,1 from platform.messages
   union all select (p->>'id')::uuid,p->>'name',2 from platform.conversations c,
     lateral jsonb_array_elements(jsonb_build_array(c.a,c.b) || coalesce(c.participants,'[]'::jsonb)) p where p->>'kind'='user'
  ) names where label is not null and length(trim(label))>0 order by id,priority
 loop
  perform platform.sync_profile_name(person.id,person.label);
 end loop;
end $$;

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
 label=case when event->>'outcome'='completed' then 'Voice call' else 'Unanswered voice call' end;
 insert into platform.messages(id,conversation_id,sender,actor_id,actor_name,body,call_event,created_at)
 values(call_id,convo.id,sender,(c->'caller'->>'id')::uuid,c->'caller'->>'name',label,event,to_timestamp((c->>'endedAt')::double precision/1000))
 on conflict(id) do nothing;
 update platform.conversations set updated_at=greatest(updated_at,to_timestamp((c->>'endedAt')::double precision/1000)) where id=convo.id;
end $$;
revoke all on function platform.publish_call_message(uuid) from public,anon,authenticated;
grant execute on function platform.publish_call_message(uuid) to platform_group_runtime;


update platform.messages set body=replace(replace(body,'Audio call','Voice call'),'audio call','voice call') where call_event is not null;
