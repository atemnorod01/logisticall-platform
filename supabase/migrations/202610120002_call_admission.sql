-- Serialize only call admissions sharing a user, rather than every call globally.
create table platform.call_admission_locks(user_id uuid primary key);
alter table platform.call_admission_locks enable row level security;
revoke all on platform.call_admission_locks from public,anon,authenticated;
grant select,insert,update on platform.call_admission_locks to platform_group_runtime;
create policy call_admission_runtime on platform.call_admission_locks to platform_group_runtime using(true) with check(true);
create index audio_calls_live_caller on platform.audio_calls ((data->'caller'->>'id')) where data->>'status'<>'ended';
create index audio_calls_live_callee on platform.audio_calls ((data->'callee'->>'id')) where data->>'status'<>'ended';

create index audio_calls_ended_age on platform.audio_calls (((data->>'createdAt')::bigint)) where data->>'status'='ended';
