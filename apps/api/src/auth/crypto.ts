import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function tokenVault(key: Buffer) {
  if (key.length !== 32) throw new Error('Session encryption requires 32 bytes');
  return {
    seal(value: unknown, binding: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(binding));
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    open<T>(value: string, binding: string): T {
      const data = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAAD(Buffer.from(binding));
      cipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
    },
  };
}
