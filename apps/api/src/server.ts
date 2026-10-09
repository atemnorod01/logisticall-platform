import { postgresPresence } from "./presence.js";
import { z } from "zod";
import { Pool } from "pg";
import { buildApp } from "./app.js";
import { browserSessions } from "./auth/browser.js";
import { discoverProvider } from "./auth/provider.js";
import { postgresSessionStore } from "./auth/store.js";
import { iamIdentity } from "./iam.js";
import { postgresLoginAdmission } from "./auth/admission.js";
const https = z.url().refine((v) => new URL(v).protocol === "https:");
const config = z
  .object({
    IAM_ISSUER: https,
    IAM_CLIENT_ID: z.string().min(1),
    IAM_API_URL: https,
    AUTH_MODE: z.enum(["browser", "protocol"]).default("browser"),
    APP_ORIGIN: https.optional(),
    SESSION_DATABASE_URL: z.string().optional(),
    SESSION_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i)
      .optional(),
    SESSION_DATABASE_CA: z.string().optional(),
    LOGIN_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(120),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default("127.0.0.1"),
  })
  .parse(process.env);
let pool: Pool | undefined;
let browser: ReturnType<typeof browserSessions> | undefined;
if (config.AUTH_MODE === "browser") {
  if (
    !config.APP_ORIGIN ||
    !config.SESSION_DATABASE_URL ||
    !config.SESSION_ENCRYPTION_KEY
  )
    throw Error("Browser authentication configuration is required");
  const database = new URL(config.SESSION_DATABASE_URL);
  if ([...database.searchParams.keys()].some((k) => k.startsWith("ssl")))
    throw Error(
      "Configure database TLS through SESSION_DATABASE_CA, not URL overrides",
    );
  pool = new Pool({
    connectionString: config.SESSION_DATABASE_URL,
    ssl: {
      rejectUnauthorized: true,
      ...(config.SESSION_DATABASE_CA ? { ca: config.SESSION_DATABASE_CA } : {}),
    },
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  const check = await pool.query(
    "select current_user as role, pg_has_role(current_user,'platform_session_runtime','USAGE') as session_access, has_schema_privilege(current_user,'platform','USAGE') as tenant_access",
  );
  if (!check.rows[0]?.session_access || check.rows[0]?.tenant_access) {
    await pool.end();
    throw Error("Use a dedicated session database login");
  }
  pool.on("error", () => {
    console.error("Session database connection failed");
  });
  const provider = await discoverProvider(
    config.IAM_ISSUER,
    config.IAM_CLIENT_ID,
    new URL("/auth/callback", config.APP_ORIGIN).href,
  ).catch(async (error) => {
    await pool!.end();
    throw error;
  });
  browser = browserSessions({
    origin: config.APP_ORIGIN,
    key: Buffer.from(config.SESSION_ENCRYPTION_KEY, "hex"),
    store: postgresSessionStore(pool),
    provider,
    identity: iamIdentity(config.IAM_API_URL),
    admitLogin: postgresLoginAdmission(pool, config.LOGIN_PER_MINUTE),
  });
} else if (process.env.NODE_ENV === "production")
  throw Error("Protocol-only mode is disabled in production");
const app = buildApp(
  {
    issuer: config.IAM_ISSUER,
    clientId: config.IAM_CLIENT_ID,
    iamApi: config.IAM_API_URL,
  },
  browser ? { browser, presence: postgresPresence(pool!) } : {},
);
if (pool) {
  const sessions = pool;
  let cleaning = false;
  const cleanup = setInterval(() => {
    if (cleaning) return;
    cleaning = true;
    void Promise.all([
      sessions.query(
        "delete from platform_auth.login_transactions where expires_at<$1",
        [Date.now()],
      ),
      sessions.query(
        "delete from platform_auth.sessions where idle_expires_at<$1 or absolute_expires_at<$1",
        [Date.now()],
      ),
      sessions.query(
        "delete from platform_auth.login_admission where window_start < date_trunc('minute',clock_timestamp()) - interval '2 minutes'",
      ),
    ])
      .catch(() => {
        console.error("Expired session cleanup failed");
      })
      .finally(() => {
        cleaning = false;
      });
  }, 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    await sessions.end();
  });
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.HOST, port: config.PORT });
