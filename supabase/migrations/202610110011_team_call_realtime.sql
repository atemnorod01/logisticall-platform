-- Notify every invited team member in the same transaction as the call change.
-- The payload is only an invalidation; fetching/answering still checks membership.
create or replace function platform.notify_call_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare current_call jsonb; previous_call jsonb='{}'; target text;
begin
 current_call=case when TG_OP='DELETE' then old.data else new.data end;
 if TG_OP='UPDATE' then
   previous_call=old.data;
   -- Heartbeats must not trigger another sync/heartbeat feedback loop.
   if (current_call-'callerSeen'-'calleeSeen')=(previous_call-'callerSeen'-'calleeSeen') then return null; end if;
 end if;
 -- Include previous recipients so removal/claim/cancellation clears their UI too.
 for target in
   select distinct concat_ws(':',party->>'organizationId',party->>'id')
   from jsonb_array_elements(
     jsonb_build_array(current_call->'caller',current_call->'callee',previous_call->'caller',previous_call->'callee')
     || coalesce(current_call->'recipients','[]'::jsonb)
     || coalesce(previous_call->'recipients','[]'::jsonb)
   ) party
   where party->>'organizationId' is not null and party->>'id' is not null
 loop
   perform platform.emit_workspace_change(target,'calls');
 end loop;
 return null;
end $$;
revoke all on function platform.notify_call_change() from public,anon,authenticated,platform_group_runtime;
drop trigger if exists workspace_change on platform.audio_calls;
create trigger workspace_change after insert or update or delete on platform.audio_calls
for each row execute function platform.notify_call_change();
