-- Pending invitees are visible to existing organization administrators, without activation or edit rights.
CREATE OR REPLACE FUNCTION public.integration_members(p_organization_id uuid, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := iam_private.settings_admin(p_organization_id); actor_role text; result jsonb;
begin
 if p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>100 then raise exception 'Invalid pagination' using errcode='22023'; end if;
 select role_id into actor_role from public.memberships where organization_id=p_organization_id and user_id=actor;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
 select m.user_id,p.display_name as name,u.email,m.role_id,m.status,
 (m.status<>'pending' and (m.user_id=actor or m.role_id='member' or (actor_role='owner' and m.role_id='admin'))) as can_edit_name,
 (m.status<>'pending' and m.user_id<>actor and m.role_id<>'owner' and (actor_role='owner' or m.role_id='member')) as can_edit_access,
 (m.status<>'pending' and actor_role='owner' and m.user_id<>actor and m.role_id<>'owner') as can_edit_role
 from public.memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
 where m.organization_id=p_organization_id and (m.status in ('active','suspended') or (m.status='pending' and exists(select 1 from public.invitations i where i.id=m.invitation_id and i.organization_id=m.organization_id and i.accepted_at is null and i.revoked_at is null))) and (p_user_id is null or m.user_id=p_user_id)
 and (p_search='' or strpos(lower(p.display_name),lower(p_search))>0 or strpos(lower(u.email),lower(p_search))>0)
 order by lower(p.display_name),m.user_id offset p_offset limit 50
 ) t;
 return result;
end $function$
;
