import { z } from "zod";

export interface PortaoneAlias {
  internalId: number;
  id: string;
  blocked: boolean | null;
}
export interface PortaoneAccount {
  internalId: number;
  id: string;
  type: number;
  productId: number | null;
  productName: string | null;
  status: "Open" | "Inactive" | "Terminated" | "Blocked" | "Unknown";
  aliases: PortaoneAlias[];
}
export interface PortaoneAccounts {
  importedAt: string;
  accounts: PortaoneAccount[];
}
export const accountTypeNames: Record<number, string> = {
  [-1]: "Debit",
  0: "Voucher",
  1: "Credit",
  2: "Alias",
  3: "Internal",
  4: "Beneficiary",
};
const identifier = z.number().int().positive();
const accountSchema = z.object({
  i_account: identifier,
  id: z.string().min(1),
  i_customer: identifier,
  billing_model: z.number().int(),
  i_product: identifier.nullish(),
  product_name: z.string().nullish(),
  bill_status: z.string().nullish(),
  blocked: z.string().nullish(),
});
const aliasSchema = z.object({
  i_account: identifier,
  id: z.string().min(1),
  i_master_account: identifier.nullish(),
  blocked: z.string().nullish(),
});
export type PortaoneRead = (
  path: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

// Whitelist displayed fields; API responses may also contain authentication credentials.
export async function readPortaoneAccounts(
  customerId: string,
  read: PortaoneRead,
): Promise<PortaoneAccounts> {
  if (
    !/^\d+$/.test(customerId) ||
    !Number.isSafeInteger(Number(customerId)) ||
    Number(customerId) < 1
  )
    throw new Error("Invalid PortaOne customer ID.");
  async function pages(
    path: string,
    key: string,
    params: Record<string, unknown>,
  ): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seen = new Set<number>();
    while (true) {
      const result = await read(path, {
        ...params,
        limit: 100,
        offset: rows.length,
        get_total: 1,
      });
      const chunk = result[key];
      if (!Array.isArray(chunk))
        throw new Error("PortaOne returned an invalid account list.");
      const total = result.total == null ? undefined : Number(result.total);
      if (total !== undefined && (!Number.isSafeInteger(total) || total < 0))
        throw new Error("Invalid account count from PortaOne.");
      for (const row of chunk) {
        const id = identifier.parse(row?.i_account);
        if (seen.has(id))
          throw new Error(
            "PortaOne accounts changed during import. Please try again.",
          );
        seen.add(id);
        rows.push(row);
      }
      if (total !== undefined && rows.length >= total) break;
      if (!chunk.length) {
        if (total !== undefined && rows.length < total)
          throw new Error(
            "Incomplete PortaOne account list. Please try again.",
          );
        break;
      }
      if (rows.length > 100000)
        throw new Error("PortaOne account list exceeded the import limit.");
    }
    return rows;
  }
  const rows = await pages("/Account/get_account_list", "account_list", {
    i_customer: Number(customerId),
    get_only_real_accounts: 1,
    expand_alias: 0,
    get_statuses: 1,
  });
  const accounts = rows.map((row) => {
    const a = accountSchema.parse(row);
    if (a.i_customer !== Number(customerId) || a.billing_model === 2)
      throw new Error(
        "PortaOne returned an account outside the requested grouping.",
      );
    return {
      internalId: a.i_account,
      id: a.id,
      type: a.billing_model,
      productId: a.i_product ?? null,
      productName: a.product_name ?? null,
      status:
        a.bill_status === "C"
          ? "Terminated"
          : a.bill_status === "I"
            ? "Inactive"
            : a.blocked === "Y"
              ? "Blocked"
              : a.bill_status === "O"
                ? "Open"
                : "Unknown",
      aliases: [],
    } as PortaoneAccount;
  });
  // Bound parallel reads so large customers do not overwhelm PortaOne.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, accounts.length) }, async () => {
      while (next < accounts.length) {
        const account = accounts[next++]!;
        const aliases = await pages("/Account/get_alias_list", "alias_list", {
          i_master_account: account.internalId,
        });
        account.aliases = aliases
          .map((row) => {
            const a = aliasSchema.parse(row);
            if (
              a.i_master_account != null &&
              a.i_master_account !== account.internalId
            )
              throw new Error(
                "PortaOne returned an alias for a different account.",
              );
            return {
              internalId: a.i_account,
              id: a.id,
              blocked:
                a.blocked === "Y" ? true : a.blocked === "N" ? false : null,
            };
          })
          .sort((a, b) => a.id.localeCompare(b.id));
      }
    }),
  );
  const aliasIds = accounts.flatMap((a) => a.aliases.map((x) => x.internalId));
  if (
    new Set(aliasIds).size !== aliasIds.length ||
    aliasIds.some((id) => accounts.some((a) => a.internalId === id))
  )
    throw new Error(
      "PortaOne returned conflicting account relationships. Please try again.",
    );
  return { importedAt: new Date().toISOString(), accounts };
}
