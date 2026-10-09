import type { Pool, PoolClient } from "pg";
import type { z } from "zod";
import {
  groupSchema,
  type Group,
  groupCreate,
  groupUpdate,
  groupMemberSchema,
  networkGroupSchema,
} from "../../../packages/types/src/groups.js";
export type GroupActor = {
  userId: string;
  organizationId: string;
  organizationName: string;
};
export class GroupFailure extends Error {
  constructor(public statusCode: number) {
    super("Group request rejected");
  }
}
export type GroupMember = z.infer<typeof groupMemberSchema>;
export interface GroupStore {
  list(
    actor: GroupActor,
    offset: number,
    membershipKey?: string,
  ): Promise<Group[]>;
  detail(
    actor: GroupActor,
    id: string,
  ): Promise<{ group: Group; members: GroupMember[] }>;
  inbox(actor: GroupActor, id: string, key: string): Promise<Group>;
  create(actor: GroupActor, input: z.infer<typeof groupCreate>): Promise<Group>;
  update(
    actor: GroupActor,
    id: string,
    input: z.infer<typeof groupUpdate>,
  ): Promise<Group>;
  member(
    actor: GroupActor,
    id: string,
    version: number,
    target:
      | { user_id: string; name: string; membership_key: string }
      | { user_id: string },
    remove: boolean,
  ): Promise<Group>;
  network(
    actor: GroupActor,
    offset: number,
    search: string,
  ): Promise<z.infer<typeof networkGroupSchema>[]>;
}
export function postgresGroups(pool: Pick<Pool, "connect">): GroupStore {
  async function transaction<T>(
    actor: GroupActor,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",
        [actor.organizationId, actor.userId],
      );
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      if ((error as { code?: string }).code === "23505")
        throw new GroupFailure(409);
      throw error;
    } finally {
      client.release();
    }
  }
  const audit = async (
    c: PoolClient,
    a: GroupActor,
    id: string,
    action: string,
    details: unknown = {},
    target: string | null = null,
  ) => {
    await c.query(
      "insert into platform.group_audit(organization_id,group_id,actor_id,action,details,target_user_id) values($1,$2,$3,$4,$5,$6)",
      [a.organizationId, id, a.userId, action, JSON.stringify(details), target],
    );
  };
  async function locked(
    c: PoolClient,
    a: GroupActor,
    id: string,
    version?: number,
  ) {
    const r = await c.query(
      "select * from platform.groups where organization_id=$1 and id=$2 for update",
      [a.organizationId, id],
    );
    if (!r.rows[0]) throw new GroupFailure(404);
    const g = groupSchema.parse(r.rows[0]);
    if (version !== undefined && g.version !== version)
      throw new GroupFailure(409);
    return g;
  }
  async function publish(c: PoolClient, a: GroupActor, g: Group) {
    await c.query(
      "delete from platform.group_directory where organization_id=$1 and id=$2",
      [a.organizationId, g.id],
    );
    if (g.visibility === "network" && !g.archived)
      await c.query(
        "insert into platform.group_directory values($1,$2,$3,$4,$5)",
        [a.organizationId, g.id, g.name, g.description, a.organizationName],
      );
  }
  return {
    list(a, offset, key) {
      return transaction(a, async (c) => {
        const result =
          key === undefined
            ? await c.query(
                "select g.*, (select count(*)::integer from platform.group_members m where m.organization_id=g.organization_id and m.group_id=g.id) as member_count from platform.groups g where g.organization_id=$1 order by g.name,g.id offset $2 limit 50",
                [a.organizationId, offset],
              )
            : await c.query(
                "select g.* from platform.groups g join platform.group_members m on m.organization_id=g.organization_id and m.group_id=g.id where g.organization_id=$1 and m.user_id=$2 and m.membership_key=$3 and not g.archived order by g.name,g.id offset $4 limit 50",
                [a.organizationId, a.userId, key, offset],
              );
        return result.rows.map((r) => groupSchema.parse(r));
      });
    },
    detail(a, id) {
      return transaction(a, async (c) => {
        const group = await locked(c, a, id);
        const r = await c.query(
          "select user_id,member_name as name,membership_key from platform.group_members where organization_id=$1 and group_id=$2 order by member_name,user_id limit 200",
          [a.organizationId, id],
        );
        return {
          group,
          members: r.rows.map((r) => groupMemberSchema.parse(r)),
        };
      });
    },
    inbox(a, id, key) {
      return transaction(a, async (c) => {
        const r = await c.query(
          "select g.* from platform.groups g join platform.group_members m on m.organization_id=g.organization_id and m.group_id=g.id where g.organization_id=$1 and g.id=$2 and m.user_id=$3 and m.membership_key=$4 and not g.archived",
          [a.organizationId, id, a.userId, key],
        );
        if (!r.rows[0]) throw new GroupFailure(403);
        return groupSchema.parse(r.rows[0]);
      });
    },
    create(a, input) {
      return transaction(a, async (c) => {
        const r = await c.query(
          "insert into platform.groups(organization_id,id,name,description,visibility) values($1,$2,$3,$4,$5) on conflict(organization_id,id) do nothing returning *",
          [
            a.organizationId,
            input.id,
            input.name,
            input.description,
            input.visibility,
          ],
        );
        if (!r.rows[0]) {
          const current = await locked(c, a, input.id);
          if (
            current.name !== input.name ||
            current.description !== input.description ||
            current.visibility !== input.visibility ||
            current.archived
          )
            throw new GroupFailure(409);
          return current;
        }
        const group = groupSchema.parse(r.rows[0]);
        await publish(c, a, group);
        await audit(c, a, group.id, "group.created", {
          name: group.name,
          visibility: group.visibility,
        });
        return group;
      });
    },
    update(a, id, input) {
      return transaction(a, async (c) => {
        const old = await locked(c, a, id, input.version);
        const r = await c.query(
          "update platform.groups set name=$3,description=$4,visibility=$5,archived=$6,version=version+1 where organization_id=$1 and id=$2 returning *",
          [
            a.organizationId,
            id,
            input.name,
            input.description,
            input.visibility,
            input.archived,
          ],
        );
        const group = groupSchema.parse(r.rows[0]);
        await publish(c, a, group);
        await audit(c, a, id, "group.updated", {
          before: {
            name: old.name,
            visibility: old.visibility,
            archived: old.archived,
          },
          after: {
            name: group.name,
            visibility: group.visibility,
            archived: group.archived,
          },
        });
        return group;
      });
    },
    member(a, id, version, target, remove) {
      return transaction(a, async (c) => {
        const group = await locked(c, a, id, version);
        if (group.archived) throw new GroupFailure(409);
        if (remove) {
          const r = await c.query(
            "delete from platform.group_members where organization_id=$1 and group_id=$2 and user_id=$3 returning user_id",
            [a.organizationId, id, target.user_id],
          );
          if (!r.rowCount) throw new GroupFailure(404);
        } else {
          if (!("membership_key" in target)) throw new GroupFailure(400);
          const count = await c.query(
            "select count(*)::integer as count from platform.group_members where organization_id=$1 and group_id=$2",
            [a.organizationId, id],
          );
          if (count.rows[0].count >= 200) throw new GroupFailure(409);
          await c.query(
            "insert into platform.group_members(organization_id,group_id,user_id,member_name,membership_key) values($1,$2,$3,$4,$5) on conflict(organization_id,group_id,user_id) do update set membership_key=excluded.membership_key,member_name=excluded.member_name",
            [
              a.organizationId,
              id,
              target.user_id,
              target.name,
              target.membership_key,
            ],
          );
        }
        await audit(
          c,
          a,
          id,
          remove ? "member.removed" : "member.added",
          {},
          target.user_id,
        );
        const r = await c.query(
          "update platform.groups set version=version+1 where organization_id=$1 and id=$2 returning *",
          [a.organizationId, id],
        );
        return groupSchema.parse(r.rows[0]);
      });
    },
    network(a, offset, search) {
      return transaction(a, async (c) => {
        const r = await c.query(
          "select * from platform.group_directory where ($1='' or strpos(lower(name||' '||organization_name),lower($1))>0) order by organization_name,name,id offset $2 limit 50",
          [search, offset],
        );
        return r.rows.map((r) => networkGroupSchema.parse(r));
      });
    },
  };
}
