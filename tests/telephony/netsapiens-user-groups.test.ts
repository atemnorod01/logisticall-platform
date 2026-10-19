import { expect, it } from "vitest";
import { splitNetSapiensUsers } from "../../apps/web/src/netsapiens-user-groups";

it("separates portal users from resources without losing or modifying provider records", () => {
  const rows: Record<string, string>[] = [
    { user: "101", email: " person@example.com ", "user-scope": "Basic User" },
    { user: "102", email: "manager@example.com", "user-scope": "Office Manager" },
    { user: "103", email: "nonblank", "user-scope": "" },
    { user: "001", email: "", "user-scope": "Basic User" },
    { user: "002", email: " \t ", "user-scope": "Office Manager" },
    { user: "003", email: "blank@replaceme.com", "user-scope": "Basic User" },
    { user: "004", email: " BLANK@REPLACEME.COM ", "user-scope": "Office Manager" },
    { user: "005", email: "route@example.com", "user-scope": "No Portal" },
    { user: "006", email: "route@example.com", "user-scope": " noPortal " },
    { user: "007", email: "route@example.com", "user-scope": "NO_PORTAL" },
    { user: "9999" },
  ];
  const original = structuredClone(rows);
  const { users, otherResources } = splitNetSapiensUsers(rows);
  expect(users.map((r) => r.user)).toEqual(["101", "102", "103"]);
  expect(otherResources.map((r) => r.user)).toEqual(["001", "002", "003", "004", "005", "006", "007", "9999"]);
  expect(users.length + otherResources.length).toBe(rows.length);
  expect(rows).toEqual(original);
  expect(users[0]).toBe(rows[0]);
});

it("keeps empty provider lists empty in both categories", () => {
  expect(splitNetSapiensUsers([])).toEqual({ users: [], otherResources: [] });
});
