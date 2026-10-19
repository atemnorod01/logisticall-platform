import {useNumberConsole} from './console-api.js';
import {useCallback} from 'react';
export type Gateway = {
  active?: string;
  revision?: number;
  error?: string;
  sampled_at?: number;
  b2b_calls?: number;
  proxy_calls?: number;
  registrations?: { Records?: { enabled?: string; state?: string }[] };
};
export type Trunk = {
  server: string;
  ip: string;
  port: number;
  username: string;
  realm: string;
  enabled: boolean;
};
export type RoutingConfig = {
  routes: { did: string; destination: string }[];
  nodes: Record<string, Trunk>;
  jambonz: { id: string; name: string; ip: string; port: number }[];
  bandwidth: string[];
};
export type RouteOperation = {
  id: string;
  did: string;
  destination: string | null;
  state: string;
  revision: number;
  error?: string;
  nodes?: Record<string, { state: string; revision?: number }>;
};
export type GatewaySnapshot = {
  revision: number;
  config: RoutingConfig;
  nodes: Record<string, Gateway>;
  organizations: Record<string, string>;
  did_operations: RouteOperation[];
  result?: { state?: string };
  collector?: Record<string, { ok: boolean }>;
};
export function useManagementRequest(){
 const consoleFetch=useNumberConsole().fetch;
 return useCallback(async function managementRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await consoleFetch("/routing" + path, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!response.ok)
    throw new Error(
      data?.error ||
        data?.message ||
        (response.status === 401
          ? "Your session expired. Sign in again."
          : "OpenSIPS management is unavailable. Refresh to check the current state."),
    );
  if (!data || typeof data !== "object")
    throw new Error(
      "Unexpected management response. Refresh to verify the current state.",
    );
  return data as T;
 },[consoleFetch]);
}
export function routeLabel(
  snapshot: GatewaySnapshot | undefined,
  destination: string | undefined,
) {
  if (!destination) return "Not configured";
  if (destination === "portaone") return "PortaOne";
  const peer = snapshot?.config.jambonz.find((p) => p.id === destination);
  return peer
    ? `Voice platform · ${peer.name}`
    : `Unknown destination (${destination})`;
}
export function routeState(
  snapshot: GatewaySnapshot | undefined,
  number: string,
) {
  if (!snapshot) return "Unable to verify";
  const pending = snapshot.did_operations.find((o) => o.state !== "applied");
  if (pending?.did === number) return "Needs attention";
  if (!snapshot.config.routes.some((r) => r.did === number))
    return "Not configured";
  const nodes = Object.keys(snapshot.config.nodes);
  return nodes.length >= 2 &&
    nodes.every(
      (n) =>
        snapshot.nodes[n]?.active === "active" &&
        snapshot.nodes[n]?.revision === snapshot.revision,
    )
    ? "Both gateways synchronized"
    : "Gateways need attention";
}
