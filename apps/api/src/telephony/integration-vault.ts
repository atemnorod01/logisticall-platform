import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

export const integrationVaultSchema = `CREATE TABLE IF NOT EXISTS telephony.integration_secrets (
 id text PRIMARY KEY, envelope jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);`;
export interface SecretRecords {
  get(id: string): Promise<unknown | undefined>;
  put(id: string, value: unknown): Promise<void>;
}
export interface IntegrationVault extends SecretRecords {
  locked<T>(id: string, fn: (records: SecretRecords) => Promise<T>): Promise<T>;
}
const envelope = z
  .object({
    version: z.literal(1),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  })
  .strict();
export function credentialCipher(hexKey: string) {
  if (!/^[a-f\d]{64}$/i.test(hexKey))
    throw new Error("INTEGRATION_VAULT_KEY must be a 32-byte hexadecimal key.");
  const key = Buffer.from(hexKey, "hex");
  const aad = (id: string) => Buffer.from("logisticall:integration:v1:" + id);
  return {
    seal(id: string, value: unknown) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(id));
      return {
        version: 1,
        iv: iv.toString("base64"),
        ciphertext: Buffer.concat([
          cipher.update(JSON.stringify(value), "utf8"),
          cipher.final(),
        ]).toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      };
    },
    open(id: string, input: unknown): unknown {
      try {
        const data = envelope.parse(input),
          iv = Buffer.from(data.iv, "base64"),
          tag = Buffer.from(data.tag, "base64");
        if (iv.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad(id));
        decipher.setAuthTag(tag);
        return JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(data.ciphertext, "base64")),
            decipher.final(),
          ]).toString("utf8"),
        );
      } catch {
        throw new Error(
          "Stored integration credentials could not be decrypted.",
        );
      }
    },
  };
}
export class PostgresIntegrationVault implements IntegrationVault {
  constructor(private pool: Pool) {}

  private records(client: Pool | PoolClient): SecretRecords {
    return {
      get: async (id) => {
        const result = await client.query(
          "SELECT telephony.read_integration_secret($1) AS value", [id],
        );
        return result.rows[0]?.value ?? undefined;
      },
      put: async (id, value) => {
        await client.query("SELECT telephony.write_integration_secret($1,$2::jsonb)", [id, value]);
      },
    };
  }
  get(id: string) {
    return this.records(this.pool).get(id);
  }
  put(id: string, value: unknown) {
    return this.locked(id, (records) => records.put(id, value));
  }
  async locked<T>(
    id: string,
    fn: (records: SecretRecords) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,711203))",
        [id],
      );
      const result = await fn(this.records(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
