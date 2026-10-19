import { it, expect, vi } from "vitest";
import {
  memberInvitationService,
  suggestMemberExtension,
  MemberCreateRejected,
  type MemberInviteOperation,
} from "../../apps/api/src/telephony/member-invitation";
const human = (user: string) => ({
  user,
  email: `user${user}@example.com`,
  "user-scope": "Basic User",
});
it("suggests the first gap in the normal sequence, ignores outliers and services, and preserves width", () => {
  expect(
    suggestMemberExtension(
      ["201", "202", "203", "204", "205", "299"].map(human),
    ),
  ).toBe("206");
  expect(suggestMemberExtension(["201", "203", "204", "299"].map(human))).toBe(
    "202",
  );
  expect(
    suggestMemberExtension([
      ...["2001", "2002", "2099"].map(human),
      { user: "001", email: "blank@replaceme.com", "user-scope": "No Portal" },
      { user: "9999", email: "aa@example.com", "user-scope": "No Portal" },
    ]),
  ).toBe("2003");
  expect(
    suggestMemberExtension(
      [
        human("201"),
        {
          user: "202",
          email: "blank@replaceme.com",
          "user-scope": "No Portal",
        },
      ],
      ["203"],
    ),
  ).toBe("204");
  expect(suggestMemberExtension([])).toBe("201");
  expect(suggestMemberExtension([human("909"), human("910")])).toBe("912");
});
function fixture() {
  const ops = new Map<string, MemberInviteOperation>(),
    users = [human("201")],
    locks = new Set<string>();
  let enabled = true,
    mode = "ok",
    calls = 0;
  const service = memberInvitationService(
    {
      async exclusive(id, work) {
        if (locks.has(id)) throw Error("Busy");
        locks.add(id);
        try {
          return await work();
        } finally {
          locks.delete(id);
        }
      },
      get: async (key) =>
        ops.has(key) ? structuredClone(ops.get(key)) : undefined,
      put: async (key, op) => {
        ops.set(key, structuredClone(op));
      },
      pending: async (id) =>
        [...ops]
          .filter(
            ([, op]) =>
              op.input.organizationId === id &&
              ["reserved", "writing"].includes(op.stage),
          )
          .map(([key, operation]) => ({
            key,
            operation: structuredClone(operation),
          })),
    },
    {
      binding: async () => (enabled ? { domain: "123" } : undefined),
      users: async () => users,
      create: async (_domain, input) => {
        calls++;
        if (mode === "reject") throw new MemberCreateRejected();
        if (mode === "lost") throw Error("Timeout");
        users.push({ ...human(input.extension), email: input.email });
        if (mode === "lost-after") throw Error("Timeout");
      },
    },
  );
  const member = vi.fn(async () => ({ id: "invite", user_id: "user" }));
  const input = {
    organizationId: "org",
    requestId: "request",
    name: "New Member",
    email: "new@example.com",
    extension: "202",
  };
  return {
    service,
    member,
    input,
    users,
    ops,
    calls: () => calls,
    setMode: (value: string) => {
      mode = value;
    },
    disable: () => {
      enabled = false;
    },
  };
}
it("uses custom extensions, verifies creation, and retries without duplicating a PBX user", async () => {
  const f = fixture();
  const input = { ...f.input, extension: "245" };
  expect(await f.service.invite(input, f.member)).toMatchObject({
    extension: "245",
  });
  expect(await f.service.invite(input, f.member)).toMatchObject({
    extension: "245",
  });
  expect(f.calls()).toBe(1);
  expect(f.users.find((u) => u.user === "245")?.email).toBe("new@example.com");
});
it("rejects collisions and disabled organizations before creating a member", async () => {
  const f = fixture();
  await expect(
    f.service.invite({ ...f.input, extension: "201" }, f.member),
  ).rejects.toThrow("already in use");
  expect(f.member).not.toHaveBeenCalled();
  f.disable();
  await expect(f.service.suggestion("org")).rejects.toThrow("not enabled");
  await expect(f.service.invite(f.input, f.member)).rejects.toThrow(
    "not enabled",
  );
  expect(f.calls()).toBe(0);
});
it("reconciles lost responses, never replays ambiguous writes, and can resume a reopened form", async () => {
  const f = fixture();
  f.setMode("lost");
  await expect(f.service.invite(f.input, f.member)).rejects.toThrow(
    "not confirmed",
  );
  expect(await f.service.suggestion("org")).toEqual({ extension: "203" });
  await expect(
    f.service.invite({ ...f.input, requestId: "reopened" }, f.member),
  ).rejects.toThrow("unconfirmed");
  expect(f.calls()).toBe(1);
  f.users.push({ ...human("202"), email: f.input.email });
  expect(
    await f.service.invite({ ...f.input, requestId: "reopened" }, f.member),
  ).toMatchObject({ extension: "202" });
  expect(f.calls()).toBe(1);
  const accepted = fixture();
  accepted.setMode("lost-after");
  expect(
    await accepted.service.invite(accepted.input, accepted.member),
  ).toMatchObject({ extension: "202" });
  expect(accepted.calls()).toBe(1);
});
it("allows a definite rejection to retry but prevents revoked membership and changed domains from recreating users", async () => {
  const f = fixture();
  f.setMode("reject");
  await expect(f.service.invite(f.input, f.member)).rejects.toThrow("rejected");
  f.setMode("ok");
  await expect(
    f.service.invite(f.input, async () => {
      throw Error("Revoked");
    }),
  ).rejects.toThrow("Revoked");
  expect(f.calls()).toBe(1);
  expect(
    await f.service.invite({ ...f.input, extension: "250" }, f.member),
  ).toMatchObject({ extension: "250" });
  f.ops.get("org:request")!.domain = "another";
  await expect(
    f.service.invite({ ...f.input, extension: "250" }, f.member),
  ).rejects.toThrow("changed");
});
it("serializes competing requests so the second administrator cannot create a duplicate extension", async () => {
  const f = fixture();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = f.service.invite(f.input, async () => {
    await hold;
    return { id: "a", user_id: "a" };
  });
  await expect(
    f.service.invite(
      { ...f.input, requestId: "second", email: "second@example.com" },
      f.member,
    ),
  ).rejects.toThrow("Busy");
  release();
  await first;
  await expect(
    f.service.invite(
      { ...f.input, requestId: "second", email: "second@example.com" },
      f.member,
    ),
  ).rejects.toThrow("already in use");
  expect(f.calls()).toBe(1);
});
