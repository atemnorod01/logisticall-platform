-- Server-only projection for presence on individually published public teams.
create function platform.public_team_status_members(p_ids uuid[])
returns table(group_id uuid,organization_id uuid,user_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_ids is null or cardinality(p_ids)>50 then raise exception 'Invalid team list'; end if;
 return query select m.group_id,m.organization_id,m.user_id from platform.group_members m
 join platform.groups g on g.organization_id=m.organization_id and g.id=m.group_id
 join platform.group_directory d on d.organization_id=g.organization_id and d.id=g.id
 where g.id=any(p_ids) and g.visibility='network' and not g.archived;
end $$;
revoke all on function platform.public_team_status_members(uuid[]) from public,anon,authenticated;
grant execute on function platform.public_team_status_members(uuid[]) to platform_group_runtime;
