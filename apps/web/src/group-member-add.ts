import {
  groupDetail,
  groupSchema,
} from "../../../packages/types/src/groups.js";
export async function addGroupMembers(
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>,
  groupId: string,
  ids: string[],
  added: (id: string) => void,
) {
  const current = groupDetail.parse(await request(`groups/${groupId}`));
  if (current.group.archived) throw Error("archived");
  let version = current.group.version;
  for (const id of [...new Set(ids)]) {
    if (!current.members.some((m) => m.user_id === id)) {
      const result = (await request(`groups/${groupId}/members`, "POST", {
        user_id: id,
        version,
      })) as { group: unknown };
      version = groupSchema.parse(result.group).version;
    }
    added(id);
  }
}
