import { expect, it } from "vitest";
import {
  memberConversionPlan,
  provisionConvertedMembers,
} from "../../apps/api/src/telephony/member-conversion";

const members = [
  { id: "a", name: "Abigail", email: "ABIGAIL@example.com", status: "pending" },
  { id: "b", name: "Andre", email: "andre@example.com", status: "active" },
  { id: "x", name: "Archived", email: "old@example.com", status: "archived" },
  { id: "c", name: "Camilo", email: "camilo@example.com", status: "suspended" },
];

it("plans every current non-archived member silently from extension 101", () => {
  expect(memberConversionPlan(members)).toMatchObject({
    status: "running",
    members: [
      { userId: "a", email: "abigail@example.com", extension: "101" },
      { userId: "b", email: "andre@example.com", extension: "102" },
      { userId: "c", email: "camilo@example.com", extension: "103" },
    ],
  });
});

it("creates the conversion plan once and resumes without duplicate PBX users", async () => {
  const progress = memberConversionPlan(members);
  const users: { user: string; email: string; "user-scope": string; domain: string }[] = [];
  const writes: string[] = [];
  const provider = {
    domainDestinationUsers: async () => users,
    createMemberUser: async (domain: string, input: { email: string; extension: string }) => {
      writes.push(input.extension);
      users.push({
        user: input.extension,
        email: input.email,
        "user-scope": "Basic User",
        domain,
      });
    },
  };
  const saved: string[] = [];
  await provisionConvertedMembers("123", progress, provider, async value => {
    saved.push(value.status);
  });
  await provisionConvertedMembers("123", progress, provider, async () => {});
  expect(writes).toEqual(["101", "102", "103"]);
  expect(progress).toMatchObject({ status: "complete", completed: ["a", "b", "c"] });
  expect(saved.at(-1)).toBe("complete");
});

it("stops on extension or email collisions instead of assigning a different number", async () => {
  const progress = memberConversionPlan(members.slice(0, 1));
  const provider = {
    domainDestinationUsers: async () => [
      { user: "101", email: "someone@example.com", "user-scope": "Basic User" },
    ],
    createMemberUser: async () => {},
  };
  await expect(
    provisionConvertedMembers("123", progress, provider, async () => {}),
  ).rejects.toThrow("Extension 101 is already in use");
  expect(progress.status).toBe("failed");
});
