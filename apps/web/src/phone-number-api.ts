import { z } from "zod";
export class NumberRequestError extends Error {
  constructor(readonly status: number) {
    super(
      status === 409
        ? "Purchasing is paused, another operation is running, or this request conflicts with a saved order."
        : status === 429
          ? "Too many requests. Please wait a moment."
          : status === 404
            ? "Order not found yet."
            : status === 400
              ? "Check the search or purchase details."
              : "Number provisioning is unavailable. Try again shortly.",
    );
  }
}
export async function phoneRequest<T>(
  schema: z.ZodType<T>,
  path: string,
  csrf: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/v1/platform/phone-numbers" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    cache: "no-store",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new NumberRequestError(response.status);
  return schema.parse(await response.json());
}
