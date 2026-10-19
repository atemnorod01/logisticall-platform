import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import type { NetsapiensClient } from "./netsapiens";
import {
  MemberInviteError,
  memberInvitationService,
  type MemberInviteOperation,
} from "./member-invitation";

export function postgresMemberInvitation(
  pool: Pool,
  ns: NetsapiensClient,
  binding: (
    id: string,
    db?: PoolClient,
  ) => Promise<{ domain: string } | undefined>,
) {
  const context = new AsyncLocalStorage<PoolClient>();
  const db = () => {
    const client = context.getStore();
    if (!client) throw Error("Invitation lock required");
    return client;
  };
  return memberInvitationService(
    {
      async exclusive(id, work) {
        const client = await pool.connect();
        let locked = false;
        try {
          locked = (
            await client.query(
              "SELECT pg_try_advisory_lock(hashtextextended($1,180026)) AS acquired",
              [id],
            )
          ).rows[0].acquired;
          if (!locked)
            throw new MemberInviteError(
              "Another telephony operation is running. Try again shortly.",
            );
          return await context.run(client, work);
        } finally {
          try {
            if (locked)
              await client.query(
                "SELECT pg_advisory_unlock(hashtextextended($1,180026))",
                [id],
              );
            client.release();
          } catch {
            client.release(true);
          }
        }
      },
      async get(key) {
        return (
          await db().query(
            "SELECT data FROM telephony.member_invitations WHERE id=$1",
            [key],
          )
        ).rows[0]?.data as MemberInviteOperation | undefined;
      },
      async put(key, op) {
        await db().query(
          "INSERT INTO telephony.member_invitations(id,organization_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=now()",
          [key, op.input.organizationId, op],
        );
      },
      async pending(id) {
        return (
          await db().query(
            "SELECT id AS key,data AS operation FROM telephony.member_invitations WHERE organization_id=$1 AND data->>'stage' IN ('reserved','writing')",
            [id],
          )
        ).rows;
      },
    },
    {
      binding: (id) => binding(id, db()),
      users: (domain) => ns.domainDestinationUsers(domain),
      create: (domain, input) => ns.createMemberUser(domain, input),
    },
  );
}
