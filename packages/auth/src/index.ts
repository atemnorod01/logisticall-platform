import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
export function tokenVerifier(
  issuer: string,
  clientId: string,
  key?: JWTVerifyGetKey,
) {
  const url = new URL(issuer);
  if (url.protocol !== "https:") throw new Error("HTTPS issuer required");
  const jwks =
    key ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 5000,
    });
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: "authenticated",
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
      clockTolerance: 5,
    });
    if (
      payload.client_id !== clientId ||
      payload.role !== "authenticated" ||
      payload.is_anonymous === true ||
      payload.iam_setup_only === true
    )
      throw new Error("Invalid token context");
    z.uuid().parse(payload.session_id);
    if (
      !Array.isArray(payload.amr) ||
      !payload.amr.some(
        (a) =>
          a &&
          typeof a === "object" &&
          ["password", "oauth", "oauth_provider/authorization_code"].includes(a.method),
      )
    )
      throw new Error("Ineligible authentication");
    return { userId: z.uuid().parse(payload.sub) };
  };
}
