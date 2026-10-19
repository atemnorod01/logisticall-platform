import { createContext, useContext } from "react";
export type NumberConsoleClient = {
  key: string;
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
};
export const NumberConsoleContext = createContext<NumberConsoleClient | null>(
  null,
);
export function createNumberConsole(
  csrf: string,
  organizationId?: string,
): NumberConsoleClient {
  const base = organizationId
    ? `/v1/organizations/${encodeURIComponent(organizationId)}/phone-numbers/console`
    : "/v1/platform/phone-numbers/console";
  return {
    key: base,
    fetch(path, options = {}) {
      if (!path.startsWith("/") || path.includes("://"))
        throw Error("Invalid number console request");
      const method = options.method ?? "GET";
      return fetch(base + path, {
        ...options,
        ...(method === "POST" && options.body === undefined
          ? { body: "{}" }
          : {}),
        credentials: "include",
        cache: "no-store",
        headers: {
          ...options.headers,
          ...(method === "GET"
            ? {}
            : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
        },
      });
    },
  };
}
export function useNumberConsole() {
  const client = useContext(NumberConsoleContext);
  if (!client) throw Error("Number console is unavailable");
  return client;
}
