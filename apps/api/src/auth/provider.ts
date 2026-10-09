import * as oidc from 'openid-client';
import { decodeJwt, type JWTVerifyGetKey } from 'jose';
import { tokenVerifier } from '../../../../packages/auth/src/index.js';
export type Login = { state: string; nonce: string; verifier: string };
export type Tokens = { access: string; refresh: string; userId: string; expires: number };
export interface Provider {
  authorize(login: Login): Promise<string>;
  exchange(url: URL, login: Login): Promise<Tokens>;
  refresh(token: string, subject: string): Promise<Tokens>;
}
export async function discoverProvider(issuer: string, clientId: string, callback: string, dependencies: { fetcher?: typeof fetch; key?: JWTVerifyGetKey } = {}): Promise<Provider> {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== 'https:' || issuerUrl.username || issuerUrl.password) throw Error('Invalid issuer');
  const config = await oidc.discovery(issuerUrl, clientId, { token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'ES256' }, oidc.None(), { timeout: 5, ...(dependencies.fetcher ? { [oidc.customFetch]: (url: string, init: unknown) => dependencies.fetcher!(url, init as RequestInit) } : {}) });
  const metadata = config.serverMetadata();
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!endpoint || new URL(endpoint).origin !== issuerUrl.origin || new URL(endpoint).protocol !== 'https:') throw Error('Untrusted OIDC endpoint');
  }
  oidc.enableNonRepudiationChecks(config);
  const verify = tokenVerifier(issuer, clientId, dependencies.key);
  async function validate(result: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>, subject?: string): Promise<Tokens> {
    let actor;
    try { actor = await verify(result.access_token); }
    catch (error) { throw Object.assign(Error('Access token validation failed'), { cause: error, code: 'LC_ACCESS_TOKEN_INVALID' }); }
    const claims = result.claims();
    if ((claims && claims.sub !== actor.userId) || (subject && subject !== actor.userId)) throw Object.assign(Error('Subject mismatch'), { code: 'LC_SUBJECT_MISMATCH' });
    if (!result.refresh_token || result.token_type.toLowerCase() !== 'bearer') throw Object.assign(Error('Incomplete token response'), { code: 'LC_TOKEN_RESPONSE_INCOMPLETE' });
    const exp = decodeJwt(result.access_token).exp! * 1000;
    if (exp <= Date.now()) throw Error('Expired access token');
    return { access: result.access_token, refresh: result.refresh_token, userId: actor.userId, expires: exp };
  }
  return {
    async authorize(login) {
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: callback, scope: 'openid', response_type: 'code',
        state: login.state, nonce: login.nonce, code_challenge_method: 'S256',
        code_challenge: await oidc.calculatePKCECodeChallenge(login.verifier),
      }).href;
    },
    async exchange(url, login) {
      const result = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: login.verifier, expectedState: login.state,
        expectedNonce: login.nonce, idTokenExpected: true,
      });
      return validate(result);
    },
    async refresh(token, subject) {
      return validate(await oidc.refreshTokenGrant(config, token), subject);
    },
  };
}
