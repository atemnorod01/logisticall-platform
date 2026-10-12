import type { Pool } from "pg";
export type PresenceStatus =
  "available" | "away" | "busy" | "offline" | "unknown";
export interface PresenceStore {
  users?(ids: string[]): Promise<Record<string, PresenceStatus>>;
  teamStatuses?(ids: string[]): Promise<Record<string, PresenceStatus>>;
  publicTeams?(organizations: string[]): Promise<Record<string, PresenceStatus>>;
  beat(
    session: string,
    user: string,
    organization: string,
    status: "available" | "away" | "busy",
  ): Promise<void>;
  read(
    organization: string,
    users: string[],
  ): Promise<Record<string, PresenceStatus>>;
}
export function postgresPresence(pool: Pick<Pool, "query">, groupsPool?: Pick<Pool, "query"> | undefined): PresenceStore {
  const store: PresenceStore = {
    async users(ids) {
      if (!ids.length) return {};
      // Platform-admin-only view across organizations. Prefer a live session,
      // then the user's most recent presence choice across their devices.
      const result = await pool.query<{ user_id: string; status: PresenceStatus }>(
        `select distinct on (p.user_id) p.user_id,
          case when p.seen_at>extract(epoch from clock_timestamp())*1000-90000
            and s.idle_expires_at>extract(epoch from clock_timestamp())*1000
            and s.absolute_expires_at>extract(epoch from clock_timestamp())*1000
          then p.status else 'offline' end as status
         from platform_auth.presence p join platform_auth.sessions s on s.id_hash=p.session_hash
         where p.user_id=any($1::uuid[])
         order by p.user_id,
          (p.seen_at>extract(epoch from clock_timestamp())*1000-90000
            and s.idle_expires_at>extract(epoch from clock_timestamp())*1000
            and s.absolute_expires_at>extract(epoch from clock_timestamp())*1000) desc,
          p.seen_at desc`, [ids]);
      const states = Object.fromEntries(result.rows.map(row => [row.user_id, row.status]));
      return Object.fromEntries(ids.map(id => [id, states[id] ?? "offline"]));
    },
    async teamStatuses(ids) {
      if (!groupsPool) return Object.fromEntries(ids.map(id=>[id,"unknown" as const]));
      const {rows} = await groupsPool.query<{group_id:string;organization_id:string;user_id:string}>("select * from platform.public_team_status_members($1::uuid[])",[ids]);
      const statuses = new Map<string,Record<string,PresenceStatus>>();
      await Promise.all([...new Set(rows.map(m=>m.organization_id))].map(async org=>{
        statuses.set(org,await store.read(org,[...new Set(rows.filter(m=>m.organization_id===org).map(m=>m.user_id))]));
      }));
      return Object.fromEntries(ids.map(id=>[id,aggregatePresence(rows.filter(m=>m.group_id===id).map(m=>statuses.get(m.organization_id)?.[m.user_id]??"offline"))]));
    },
    async publicTeams(ids) {
      if (!groupsPool) return Object.fromEntries(ids.map(id => [id, "unknown" as const]));
      const result = await groupsPool.query<{organization_id:string;user_id:string}>("select * from platform.public_team_presence_members($1::uuid[])",[ids]);
      return publicTeamPresence(ids,result.rows,store.read);
    },
    async beat(session, user, organization, status) {
      // Bind to a currently valid opaque workspace session; never create standalone presence.
      await pool.query(
        `insert into platform_auth.presence(session_hash,organization_id,user_id,status,seen_at)
    select id_hash,$2,$3,$4,(extract(epoch from clock_timestamp())*1000)::bigint from platform_auth.sessions
    where id_hash=$1 and idle_expires_at>extract(epoch from clock_timestamp())*1000 and absolute_expires_at>extract(epoch from clock_timestamp())*1000
    on conflict(session_hash,organization_id) do update set status=excluded.status,seen_at=excluded.seen_at,user_id=excluded.user_id`,
        [session, organization, user, status],
      );
    },
    async read(organization, users) {
      if (!users.length) return {};
      // Any valid active workspace session keeps a user online. Latest active choice wins.
      const result = await pool.query<{
        user_id: string;
        status: PresenceStatus;
      }>(
        `select distinct on(p.user_id) p.user_id,
    case when p.seen_at>extract(epoch from clock_timestamp())*1000-90000 and s.idle_expires_at>extract(epoch from clock_timestamp())*1000 and s.absolute_expires_at>extract(epoch from clock_timestamp())*1000 then p.status else 'offline' end as status
    from platform_auth.presence p join platform_auth.sessions s on s.id_hash=p.session_hash
    where p.organization_id=$1 and p.user_id=any($2::uuid[])
    order by p.user_id,(p.seen_at>extract(epoch from clock_timestamp())*1000-90000 and s.idle_expires_at>extract(epoch from clock_timestamp())*1000 and s.absolute_expires_at>extract(epoch from clock_timestamp())*1000) desc,p.seen_at desc`,
        [organization, users],
      );
      return Object.fromEntries(result.rows.map((r) => [r.user_id, r.status]));
    },
  };
  return store;
}

export async function publicTeamPresence(ids:string[],members:{organization_id:string;user_id:string}[],read:PresenceStore["read"]):Promise<Record<string,PresenceStatus>> {
 return Object.fromEntries(await Promise.all(ids.map(async org=>{
  const users=[...new Set(members.filter(m=>m.organization_id===org).map(m=>m.user_id))];
  const statuses=await read(org,users);
  return [org,aggregatePresence(users.map(id=>statuses[id]??"offline"))];
 })));
}

// Available wins. Unknown is never presented as a confirmed offline team.
export function aggregatePresence(statuses: PresenceStatus[]): PresenceStatus {
  for (const state of ["available", "away", "busy", "unknown"] as const)
    if (statuses.includes(state)) return state;
  return "offline";
}
