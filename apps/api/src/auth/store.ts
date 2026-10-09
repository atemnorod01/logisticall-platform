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
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await client.query('select * from platform_auth.sessions where id_hash=$1 for update', [id]);
        const raw = result.rows[0];
        let value: Awaited<ReturnType<SessionStore['acquire']>>;
        if (raw) {
          const row: SessionRow = { ...raw, access_expires_at: Number(raw.access_expires_at), idle_expires_at: Number(raw.idle_expires_at), absolute_expires_at: Number(raw.absolute_expires_at) };
          if (row.idle_expires_at <= now || row.absolute_expires_at <= now) {
            await client.query('delete from platform_auth.sessions where id_hash=$1', [id]);
          } else if (row.refreshing) {
            value = { kind: 'busy', row };
          } else {
            const refresh = row.access_expires_at <= now + 30_000;
            await client.query('update platform_auth.sessions set refreshing=$2,idle_expires_at=least($3,absolute_expires_at) where id_hash=$1', [id, refresh, now + IDLE]);
            value = { kind: refresh ? 'refresh' : 'ready', row };
          }
        }
        // Commit the refresh marker BEFORE the external token request. Crashes
        // cannot replay an old rotated refresh token; the user must log in again.
        await client.query('commit');
        return value;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally { client.release(); }
    },
    async finishRefresh(id, ciphertext, expiry, now) {
      const result = await pool.query('update platform_auth.sessions set ciphertext=$2,access_expires_at=$3,refreshing=false where id_hash=$1 and refreshing and absolute_expires_at>$4 and idle_expires_at>$4', [id, ciphertext, expiry, now]);
      return result.rowCount === 1;
    },
    async revoke(id) { await pool.query('delete from platform_auth.sessions where id_hash=$1', [id]); },
  };
}
