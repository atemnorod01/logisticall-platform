import type { Pool } from "pg";
export type PresenceStatus =
  "available" | "away" | "busy" | "offline" | "unknown";
export interface PresenceStore {
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
export function postgresPresence(pool: Pick<Pool, "query">): PresenceStore {
  return {
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
}
