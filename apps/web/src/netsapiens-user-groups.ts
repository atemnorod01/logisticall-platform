type ResourceRow = Record<string, string>;

export function splitNetSapiensUsers(rows: readonly ResourceRow[]) {
  const users: ResourceRow[] = [];
  const otherResources: ResourceRow[] = [];
  for (const row of rows) {
    const email = (row.email ?? "").trim().toLowerCase();
    const role = (row["user-scope"] ?? "").replace(/[\s_-]+/g, "").toLowerCase();
    (email && email !== "blank@replaceme.com" && role !== "noportal"
      ? users
      : otherResources
    ).push(row);
  }
  return { users, otherResources };
}
