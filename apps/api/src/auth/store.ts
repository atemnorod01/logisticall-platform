import type { Pool } from 'pg';
export type SessionRow = { ciphertext: string; access_expires_at: number; idle_expires_at: number; absolute_expires_at: number; refreshing: boolean };
export interface SessionStore {
  putLogin(id: string, browser: string, ciphertext: string, expiry: number): Promise<void>;
  consumeLogin(id: string, browser: string, now: number): Promise<string | undefined>;
  putSession(id: string, ciphertext: string, accessExpiry: number, now: number): Promise<void>;
  acquire(id: string, now: number): Promise<{ kind: 'ready' | 'refresh' | 'busy'; row: SessionRow } | undefined>;
  finishRefresh(id: string, ciphertext: string, expiry: number, now: number): Promise<boolean>;
  revoke(id: string): Promise<void>;
}
export const IDLE = 30 * 60_000;
export const ABSOLUTE = 12 * 60 * 60_000;
export function postgresSessionStore(pool: Pick<Pool, 'query' | 'connect'>): SessionStore {
  return {
    async putLogin(id, browser, ciphertext, expiry) {
      await pool.query('insert into platform_auth.login_transactions values($1,$2,$3,$4)', [id, browser, ciphertext, expiry]);
    },
    async consumeLogin(id, browser, now) {
      const result = await pool.query('delete from platform_auth.login_transactions where id_hash=$1 and browser_hash=$2 and expires_at>$3 returning ciphertext', [id, browser, now]);
      return result.rows[0]?.ciphertext;
    },
    async putSession(id, ciphertext, expiry, now) {
      await pool.query('insert into platform_auth.sessions(id_hash,ciphertext,access_expires_at,idle_expires_at,absolute_expires_at) values($1,$2,$3,$4,$5)', [id, ciphertext, expiry, now + IDLE, now + ABSOLUTE]);
    },
    async acquire(id, now) {
      // One atomic statement validates, touches and claims refresh ownership.
      // PostgreSQL rechecks the predicate after concurrent row updates, so only
      // one request can claim a rotated refresh token. No network-spanning lock.
      const result = await pool.query(`
        update platform_auth.sessions
        set refreshing=access_expires_at<=$2::bigint+30000,
            idle_expires_at=least($3,absolute_expires_at)
        where id_hash=$1 and not refreshing
          and idle_expires_at>$2 and absolute_expires_at>$2
        returning *`, [id, now, now + IDLE]);
      const normalize = (raw: SessionRow): SessionRow => ({ ...raw,
        access_expires_at: Number(raw.access_expires_at),
        idle_expires_at: Number(raw.idle_expires_at),
        absolute_expires_at: Number(raw.absolute_expires_at),
      });
      if (result.rows[0]) {
        const row = normalize(result.rows[0]);
        return { kind: row.refreshing ? 'refresh' : 'ready', row };
      }
      const pending = await pool.query(`select * from platform_auth.sessions
        where id_hash=$1 and idle_expires_at>$2 and absolute_expires_at>$2`, [id, now]);
      if (pending.rows[0]) return { kind: 'busy', row: normalize(pending.rows[0]) };
      await pool.query(`delete from platform_auth.sessions where id_hash=$1
        and (idle_expires_at<=$2 or absolute_expires_at<=$2)`, [id, now]);
      return undefined;
    },
    async finishRefresh(id, ciphertext, expiry, now) {
      const result = await pool.query('update platform_auth.sessions set ciphertext=$2,access_expires_at=$3,refreshing=false where id_hash=$1 and refreshing and absolute_expires_at>$4 and idle_expires_at>$4', [id, ciphertext, expiry, now]);
      return result.rowCount === 1;
    },
    async revoke(id) { await pool.query('delete from platform_auth.sessions where id_hash=$1', [id]); },
  };
}
