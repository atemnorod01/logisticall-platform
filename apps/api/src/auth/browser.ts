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
  identity: (token: string) => Promise<{ user_id: string }>;
  now?: () => number;
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
        const login: Login = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
        const browser = randomToken();
        const location = await provider.authorize(login);
        await store.putLogin(digest(login.state), digest(browser), vault.seal(login, digest(login.state)), now() + 5 * 60_000);
        reply.header('Set-Cookie', cookie(LOGIN, browser, 300));
        return reply.redirect(location);
      });
      app.get('/auth/callback', async (req, reply) => {
        reply.header('Set-Cookie', cookie(LOGIN, '', 0));
        try {
          // Never reconstruct the callback origin from Host or forwarded headers.
          const url = new URL(req.raw.url!, origin.origin);
          const states = url.searchParams.getAll('state');
          const browser = readCookie(req.headers.cookie, LOGIN);
          if (states.length !== 1 || !opaque.test(states[0]!) || !browser) throw new SessionError();
          const id = digest(states[0]!);
          const ciphertext = await store.consumeLogin(id, digest(browser), now());
          if (!ciphertext) throw new SessionError();
          const login = vault.open<Login>(ciphertext, id);
          const tokens = await provider.exchange(url, login);
          if ((await identity(tokens.access)).user_id !== tokens.userId) throw new SessionError();
          const sid = randomToken(), sessionId = digest(sid);
          const value: StoredSession = { tokens, csrf: randomToken() };
          await store.putSession(sessionId, vault.seal(value, sessionId), tokens.expires, now());
          const oldSid = readCookie(req.headers.cookie, SID);
          if (oldSid) await store.revoke(digest(oldSid));
          reply.header('Set-Cookie', cookie(SID, sid, ABSOLUTE / 1000));
          return reply.redirect('/');
        } catch {
          return reply.code(401).send({ message: 'Sign-in failed. Start sign-in again.' });
        }
      });
      app.get('/auth/session', async (req, reply) => {
        try {
          const value = await session(req);
          const actor = await identity(value.tokens.access);
          if (actor.user_id !== value.tokens.userId) { await store.revoke(value.id); throw new SessionError(); }
          return { userId: actor.user_id, csrfToken: value.csrf };
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
