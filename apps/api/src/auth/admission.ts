import type { Pool } from "pg";
/** A fixed aggregate budget, independent of spoofable forwarding/IP headers. */
export function postgresLoginAdmission(
  pool: Pick<Pool, "query">,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
    throw Error("Invalid login budget");
  return async () => {
    const result = await pool.query(
      `
      insert into platform_auth.login_admission as budget (bucket,window_start,attempts)
      values ('workspace_login',date_trunc('minute',clock_timestamp()),1)
      on conflict (bucket,window_start) do update set attempts=budget.attempts+1
      where budget.attempts<$1 returning attempts`,
      [limit],
    );
    return result.rows.length === 1;
  };
}
