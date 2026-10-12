-- Organization labels are display projections; never rewrite message bodies or identities.
create function platform.rename_organization_address(value jsonb, oid uuid, label text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; item record;
begin
 if jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(platform.rename_organization_address(v,oid,label) order by n),'[]') into result from jsonb_array_elements(value) with ordinality a(v,n);
  return result;
 elsif jsonb_typeof(value)='object' then
  result=value;
  if value->>'organizationId'=oid::text and value ? 'organizationName' then
   result=jsonb_set(result,'{organizationName}',to_jsonb(label));
  end if;
  for item in select key,val from jsonb_each(result) as x(key,val) where jsonb_typeof(val) in ('array','object') loop
   result=jsonb_set(result,array[item.key],platform.rename_organization_address(item.val,oid,label));
  end loop;
  return result;
 end if;
 return value;
end $$;
revoke all on function platform.rename_organization_address(jsonb,uuid,text) from public,anon,authenticated,platform_group_runtime;
create index personal_contacts_source_organization on platform.personal_contacts((data->>'sourceOrganizationId'));
create index audio_calls_organization_labels on platform.audio_calls using gin(data);
create function platform.sync_organization_name(oid uuid, label text) returns void
language plpgsql security definer set search_path='' as $$
declare org_path jsonpath;
begin
 if oid is null or label is null or length(trim(label))=0 or length(label)>120 then raise exception 'Invalid organization'; end if;
 org_path=('$ .** ? (@.organizationId == "' || oid::text || '")')::jsonpath;
 update platform.group_directory set organization_name=label where organization_id=oid and organization_name is distinct from label;
 update platform.conversations set a=platform.rename_organization_address(a,oid,label), b=platform.rename_organization_address(b,oid,label), participants=platform.rename_organization_address(participants,oid,label), participant_requests=platform.rename_organization_address(participant_requests,oid,label), participant_events=platform.rename_organization_address(participant_events,oid,label)
 where (a @? org_path or b @? org_path or participants @? org_path or participant_requests @? org_path or participant_events @? org_path)
 and (a is distinct from platform.rename_organization_address(a,oid,label) or b is distinct from platform.rename_organization_address(b,oid,label) or participants is distinct from platform.rename_organization_address(participants,oid,label) or participant_requests is distinct from platform.rename_organization_address(participant_requests,oid,label) or participant_events is distinct from platform.rename_organization_address(participant_events,oid,label));
 update platform.messages set sender=platform.rename_organization_address(sender,oid,label)
 where (sender @? org_path)
 and (sender is distinct from platform.rename_organization_address(sender,oid,label));
 update platform.conversation_state set address=platform.rename_organization_address(address,oid,label)
 where (address @? org_path)
 and (address is distinct from platform.rename_organization_address(address,oid,label));
 update platform.audio_calls set data=platform.rename_organization_address(data,oid,label)
 where (data @? org_path)
 and (data is distinct from platform.rename_organization_address(data,oid,label));
 update platform.personal_contacts set data=jsonb_set(data,'{company}',to_jsonb(label)),updated_at=now()
 where data->>'sourceOrganizationId'=oid::text and data->>'company' is distinct from label;
 perform platform.emit_workspace_change('*','profiles');
 perform platform.emit_workspace_change('organization:'||oid::text,'profiles');
end $$;
revoke all on function platform.sync_organization_name(uuid,text) from public,anon,authenticated;
grant execute on function platform.sync_organization_name(uuid,text) to platform_group_runtime;
