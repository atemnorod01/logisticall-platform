-- Additive performance metadata; existing content, visibility and history remain intact.
alter table platform.conversations add column change_revision bigint not null default 0;
alter table platform.messages add column change_revision bigint not null default 0;
create index messages_changes on platform.messages(conversation_id,change_revision);
create index messages_public_sequence on platform.messages(conversation_id,sequence desc) where not internal;

create function platform.track_message_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update platform.conversations set change_revision=change_revision+1 where id=new.conversation_id returning change_revision into new.change_revision;
 return new;
end $$;
revoke all on function platform.track_message_revision() from public,anon,authenticated;
create trigger message_revision before insert or update on platform.messages for each row execute function platform.track_message_revision();

-- Reactions, reply previews and internal comments invalidate their containing bubble.
create function platform.track_message_dependency() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb; mid uuid;
begin
 r=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if TG_TABLE_NAME='messages' then
   if TG_OP='UPDATE' and (to_jsonb(new)-'change_revision')=(to_jsonb(old)-'change_revision') then return null; end if;
   mid=(r->>'reply_to')::uuid;
   if mid is not null then update platform.messages set change_revision=change_revision where id=mid; end if;
   -- Updating a quoted message must update visible reply previews too.
   if TG_OP='UPDATE' and (new.body is distinct from old.body or new.deleted_at is distinct from old.deleted_at) then
     update platform.messages set change_revision=change_revision where reply_to=new.id;
   end if;
 else
   mid=(r->>'message_id')::uuid;
   update platform.messages set change_revision=change_revision where id=mid;
 end if;
 return null;
end $$;
revoke all on function platform.track_message_dependency() from public,anon,authenticated;
create trigger message_dependency after insert or update on platform.messages for each row execute function platform.track_message_dependency();
create trigger reaction_dependency after insert or update or delete on platform.message_reactions for each row execute function platform.track_message_dependency();
create trigger attachment_dependency after insert or update or delete on platform.message_attachments for each row execute function platform.track_message_dependency();

