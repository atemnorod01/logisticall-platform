import { it, expect, vi } from "vitest";
import { NetsapiensClient } from "../../apps/api/src/telephony/netsapiens";
import { MemberCreateRejected } from "../../apps/api/src/telephony/member-invitation";
import type { IntegrationVault } from "../../apps/api/src/telephony/integration-vault";
function fixture() {
  let reseller = "289507",
    status = 200;
  const users: Record<string, string>[] = [],
    writes: unknown[] = [];
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname.replace("/ns-api/v2", "");
    if (init?.method === "POST") {
      expect(path).toBe("/domains/123/users");
      expect(init.redirect).toBe("error");
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (status === 200) users.push({ domain: "123", ...body });
      return Response.json({}, { status });
    }
    if (path === "/domains/123")
      return Response.json({ domain: "123", reseller });
    if (path === "/domains/123/users") return Response.json(users);
    throw Error("Unexpected path " + path);
  });
  const vault = {
    get: async () => ({
      clientId: "test",
      clientSecret: "test",
      accessToken: "test",
      refreshToken: "test",
      expiresAt: Date.now() + 3600000,
      reseller: "289507",
    }),
    locked: async (_key: string, work: any) => work(vault),
    put: async () => {},
  } as unknown as IntegrationVault;
  return {
    client: new NetsapiensClient(vault, request),
    writes,
    users,
    setOwner: (value: string) => {
      reseller = value;
    },
    setStatus: (value: number) => {
      status = value;
    },
  };
}
const input = {
  name: "Jamie Example",
  email: "jamie@example.com",
  extension: "206",
};
it("creates a basic PBX user in the bound domain with its dial plan, without sending credentials", async () => {
  const f = fixture();
  await f.client.createMemberUser("123", input);
  expect(f.writes).toEqual([
    {
      user: "206",
      "name-first-name": "Jamie",
      "name-last-name": "Example",
      email: input.email,
      "user-scope": "Basic User",
      "dial-plan": "123",
      "dial-policy": "US and Canada",
      "voicemail-enabled": "yes",
      synchronous: "yes",
    },
  ]);
  expect((await f.client.domainDestinationUsers("123"))[0]).toMatchObject({
    user: "206",
    domain: "123",
    email: input.email,
  });
  await expect(f.client.createMemberUser("123", input)).rejects.toBeInstanceOf(
    MemberCreateRejected,
  );
  expect(f.writes).toHaveLength(1);
});
it("checks domain ownership and distinguishes definite rejections from ambiguous failures", async () => {
  const f = fixture();
  f.setOwner("other");
  await expect(f.client.createMemberUser("123", input)).rejects.toThrow(
    "ownership",
  );
  expect(f.writes).toHaveLength(0);
  f.setOwner("289507");
  f.setStatus(409);
  await expect(f.client.createMemberUser("123", input)).rejects.toBeInstanceOf(
    MemberCreateRejected,
  );
  f.setStatus(503);
  await expect(
    f.client.createMemberUser("123", input),
  ).rejects.not.toBeInstanceOf(MemberCreateRejected);
  await expect(
    f.client.createMemberUser("123", { ...input, extension: "9999" }),
  ).rejects.toThrow();
  expect(f.writes).toHaveLength(2);
});
