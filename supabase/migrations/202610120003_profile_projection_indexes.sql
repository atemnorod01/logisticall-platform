-- Index lookup first; recursive display-name rewriting visits only matching records.
create index conversations_a_person on platform.conversations using gin(a);
create index conversations_b_person on platform.conversations using gin(b);
create index conversations_participants_person on platform.conversations using gin(participants);
create index conversations_requests_person on platform.conversations using gin(participant_requests);
create index conversations_events_person on platform.conversations using gin(participant_events);
create index messages_actor on platform.messages(actor_id);
create index messages_sender_person on platform.messages using gin(sender);
create index conversation_state_address_person on platform.conversation_state using gin(address);
create index conversation_state_assignee on platform.conversation_state(assigned_to);
create index personal_contacts_source_person on platform.personal_contacts((data->>'sourcePersonId'));
create index messages_call_caller on platform.messages((call_event->>'callerId')) where call_event is not null;
create index messages_call_callee on platform.messages((call_event->>'calleeId')) where call_event is not null;
create or replace function platform.sync_profile_name(uid uuid, label text) returns void
language plpgsql security definer set search_path='' as $$
declare person_path jsonpath;
begin
 person_path=('$ .** ? (@.kind == "user" && @.id == "' || uid::text || '")')::jsonpath;
 if uid is null or label is null or length(trim(label))=0 or length(label)>100 then raise exception 'Invalid profile'; end if;
 update platform.group_members set member_name=label where user_id=uid and member_name is distinct from label;
 update platform.conversations set
  a=platform.rename_person_address(a,uid,label), b=platform.rename_person_address(b,uid,label),
  participants=platform.rename_person_address(participants,uid,label),
  participant_requests=platform.rename_person_address(participant_requests,uid,label),
  participant_events=platform.rename_person_address(participant_events,uid,label)
 where (a @? person_path or b @? person_path or participants @? person_path or participant_requests @? person_path or participant_events @? person_path)
 and (a is distinct from platform.rename_person_address(a,uid,label)
    or b is distinct from platform.rename_person_address(b,uid,label)
    or participants is distinct from platform.rename_person_address(participants,uid,label)
    or participant_requests is distinct from platform.rename_person_address(participant_requests,uid,label)
    or participant_events is distinct from platform.rename_person_address(participant_events,uid,label));
 update platform.messages set actor_name=case when actor_id=uid then label else actor_name end,
   sender=platform.rename_person_address(sender,uid,label)
 where (actor_id=uid or sender @? person_path) and ((actor_id=uid and actor_name is distinct from label) or sender is distinct from platform.rename_person_address(sender,uid,label));
 update platform.conversation_state set address=platform.rename_person_address(address,uid,label),
   assigned_name=case when assigned_to=uid then label else assigned_name end
 where (assigned_to=uid or address @? person_path) and (address is distinct from platform.rename_person_address(address,uid,label) or (assigned_to=uid and assigned_name is distinct from label));
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

