import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { digest, randomToken, tokenVault } from './crypto.js';
import type { Login, Provider, Tokens } from './provider.js';
import { ABSOLUTE, type SessionStore } from './store.js';
const SID = '__Host-lc-session', LOGIN = '__Host-lc-login';
const opaque = /^[A-Za-z0-9_-]{43}$/;
export function readCookie(header: string | undefined, name: string): string | undefined {
  const values = (header ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (values.length !== 1) return;
  const value = values[0]!.slice(name.length + 1);
  return opaque.test(value) ? value : undefined;
}
const cookie = (name: string, value: string, age: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
export class SessionError extends Error { constructor(public statusCode = 401) { super('Session unavailable'); } }
type StoredSession = { tokens: Tokens; csrf: string };
export function browserSessions(options: {
  origin: string; key: Buffer; store: SessionStore; provider: Provider;
  identity: (token: string) => Promise<{ user_id: string; display_name?: string | null; platform_admin?: boolean }>;
  now?: () => number;
  admitLogin?: () => Promise<boolean>;
}) {
  const { store, provider, identity } = options;
  const origin = new URL(options.origin);
  if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/') throw Error('HTTPS application origin required');
  const now = options.now ?? Date.now;
  const vault = tokenVault(options.key);
  async function session(request: FastifyRequest) {
    const sid = readCookie(request.headers.cookie, SID);
    if (!sid) throw new SessionError();
    const id = digest(sid);
    const acquired = await store.acquire(id, now());
    if (!acquired) throw new SessionError();
    if (acquired.kind === 'busy') throw new SessionError(503);
    let value: StoredSession;
    try {
      value = vault.open<StoredSession>(acquired.row.ciphertext, id);
      if (acquired.kind === 'refresh') {
        const tokens = await provider.refresh(value.tokens.refresh, value.tokens.userId);
        if (tokens.userId !== value.tokens.userId) throw new Error('Subject changed');
        value = { ...value, tokens };
        if (!await store.finishRefresh(id, vault.seal(value, id), tokens.expires, now())) throw new SessionError();
      }
    } catch {
      await store.revoke(id);
      throw new SessionError();
    }
    return { id, ...value };
  }
  async function csrf(request: FastifyRequest) {
    if (request.headers.origin !== origin.origin) throw new SessionError(403);
    const value = await session(request);
    const supplied = request.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || !opaque.test(supplied) || !timingSafeEqual(Buffer.from(digest(supplied)), Buffer.from(digest(value.csrf)))) throw new SessionError(403);
    return value;
  }
  return {
    async accessToken(request: FastifyRequest) { return (await session(request)).tokens.access; },
    register(app: FastifyInstance) {
      app.addHook('onRequest', async (_req, reply) => {
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
      });
      app.addHook('preHandler', async (req, reply) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          try { await csrf(req); } catch (error) {
            return reply.code(error instanceof SessionError ? error.statusCode : 503).send({ message: 'Request rejected' });
          }
        }
      });
      app.get('/auth/login', async (_req, reply) => {
        try {
          if (options.admitLogin && !await options.admitLogin())
            return reply.code(429).header('Retry-After', '60').send({ message: 'Sign-in is busy. Please try again shortly.' });
        } catch {
          return reply.code(503).header('Retry-After', '60').send({ message: 'Sign-in is temporarily unavailable.' });
        }
        const login: Login = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
        const browser = randomToken();
        const location = await provider.authorize(login);
        await store.putLogin(digest(login.state), digest(browser), vault.seal(login, digest(login.state)), now() + 5 * 60_000);
        reply.header('Set-Cookie', cookie(LOGIN, browser, 300));
        return reply.redirect(location);
      });
      app.get('/auth/callback', async (req, reply) => {
        reply.header('Set-Cookie', cookie(LOGIN, '', 0));
        let phase = 'callback_binding';
        try {
          // Never reconstruct the callback origin from Host or forwarded headers.
          const url = new URL(req.raw.url!, origin.origin);
          const states = url.searchParams.getAll('state');
          const browser = readCookie(req.headers.cookie, LOGIN);
          if (states.length !== 1 || !opaque.test(states[0]!) || !browser) throw new SessionError();
          const id = digest(states[0]!);
          phase = 'login_state';
          const ciphertext = await store.consumeLogin(id, digest(browser), now());
          if (!ciphertext) throw new SessionError();
          phase = 'login_decrypt';
          const login = vault.open<Login>(ciphertext, id);
          phase = 'token_exchange';
          const tokens = await provider.exchange(url, login);
          phase = 'iam_identity';
          if ((await identity(tokens.access)).user_id !== tokens.userId) throw new SessionError();
          const sid = randomToken(), sessionId = digest(sid);
          const value: StoredSession = { tokens, csrf: randomToken() };
          phase = 'session_persist';
          await store.putSession(sessionId, vault.seal(value, sessionId), tokens.expires, now());
          const oldSid = readCookie(req.headers.cookie, SID);
          if (oldSid) await store.revoke(digest(oldSid));
          reply.header('Set-Cookie', cookie(SID, sid, ABSOLUTE / 1000));
          return reply.redirect('/');
        } catch (error) {
          // Only fixed stage labels and known library codes; never exception text, URLs, cookies or tokens.
          const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
          const known = ['OAUTH_INVALID_RESPONSE', 'OAUTH_RESPONSE_BODY_ERROR', 'OAUTH_JWT_CLAIM_COMPARISON_FAILED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', 'ERR_JWT_EXPIRED', 'LC_ACCESS_TOKEN_INVALID', 'LC_SUBJECT_MISMATCH', 'LC_TOKEN_RESPONSE_INCOMPLETE', 'OAUTH_UNSUPPORTED_OPERATION', 'OAUTH_WWW_AUTHENTICATE_CHALLENGE', 'OAUTH_AUTHORIZATION_RESPONSE_ERROR', 'OAUTH_PARSE_ERROR', 'OAUTH_INVALID_REQUEST', 'OAUTH_RESPONSE_IS_NOT_JSON', 'OAUTH_RESPONSE_IS_NOT_CONFORM', 'OAUTH_JWT_TIMESTAMP_CHECK_FAILED', 'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED', 'OAUTH_KEY_SELECTION_FAILED', 'OAUTH_MISSING_SERVER_METADATA', 'OAUTH_INVALID_SERVER_METADATA', 'OAUTH_TIMEOUT', 'OAUTH_ABORT'];
          const causes: string[] = [];
          let current: unknown = error;
          for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
            const entry = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
            if (typeof entry.code === 'string' && known.includes(entry.code)) causes.push(entry.code);
            else if (['ZodError','TypeError','ClientError'].includes(String(entry.name))) causes.push(String(entry.name));
            if (['Invalid token context','Ineligible authentication','Subject mismatch','Incomplete token response','Expired access token'].includes(String(entry.message))) causes.push(String(entry.message));
            current = entry.cause;
          }
          console.error(JSON.stringify({ causes, event: 'auth_callback_failed', phase, code: typeof code === 'string' && known.includes(code) ? code : 'unclassified' }));
          return reply.code(401).send({ message: 'Sign-in failed. Start sign-in again.' });
        }
      });
      app.get('/auth/session', async (req, reply) => {
        try {
          const value = await session(req);
          const actor = await identity(value.tokens.access);
          if (actor.user_id !== value.tokens.userId) { await store.revoke(value.id); throw new SessionError(); }
          return { userId: actor.user_id, displayName: actor.display_name ?? null, platformAdmin: actor.platform_admin === true, csrfToken: value.csrf };
        } catch (error) {
          return reply.code(error instanceof SessionError ? error.statusCode : 503).send({ message: 'Session unavailable' });
        }
      });
      app.post('/auth/logout', async (req, reply) => {
        const sid = readCookie(req.headers.cookie, SID);
        if (sid) await store.revoke(digest(sid));
        reply.header('Set-Cookie', cookie(SID, '', 0));
        return reply.code(204).send();
      });
    },
  };
}
