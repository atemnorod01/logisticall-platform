import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const configured = process.env.MEDIA_SIGNING_KEY || process.env.SESSION_ENCRYPTION_KEY;
if (configured && !/^[a-f0-9]{64}$/i.test(configured)) throw Error("Invalid media signing key");
if (!configured && process.env.NODE_ENV === "production") throw Error("Media signing key is required");
// Domain-separated derivation keeps media signatures stable across replicas and restarts.
const key = configured
  ? createHmac("sha256", Buffer.from(configured, "hex")).update("logisticall/media/v1").digest()
  : randomBytes(32);
const sign = (scope: string, expires: number) =>
  createHmac("sha256", key).update(`${scope}:${expires}`).digest("hex");
export function mediaSignature(scope: string) {
  const expires = Math.floor(Date.now() / 1000) + 600;
  return { expires, signature: sign(scope, expires) };
}
export function validMediaSignature(
  scope: string,
  expires: number,
  signature: string,
) {
  if (
    expires < Math.floor(Date.now() / 1000) ||
    expires > Math.floor(Date.now() / 1000) + 600 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(sign(scope, expires), "hex"),
  );
}
