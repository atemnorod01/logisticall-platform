import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Address } from "../../../packages/types/src/messaging.js";
import {
  addressKey,
  MessageFailure,
  type MessageActor,
} from "./messaging-store.js";
export type ParticipantRequest = {
  id: string;
  target: Address;
  history: "all" | "future";
  floor: number;
  requestedBy: string;
  requesterOrganization: string;
  required: string[];
  approved: string[];
  status: "pending" | "added" | "declined";
  createdAt: string;
};
export type ParticipantEvent = {
  id: string;
  text: string;
  createdAt: string;
  sequence: number;
};
export type ParticipantRow = {
  group_owner?: string | null;
  departures?: Record<string,{sequence:number;leftAt:string;reason:string}>;
  id: string;
  a: Address;
  b: Address;
  participants: Address[];
  title: string;
  created_at: Date;
  updated_at: Date;
  history_limits: Record<string, number>;
  participant_requests: ParticipantRequest[];
  participant_events: ParticipantEvent[];
};
export const endpoints = (
  row: Pick<ParticipantRow, "a" | "b" | "participants" | "departures">,
): Address[] => (row.participants.length ? row.participants : [row.a, row.b]).filter(p=>!row.departures?.[addressKey(p)]);
export const publicEndpoint = ({ membershipKey: _, ...p }: Address) => p;
export function conversationShape(
  row: Pick<ParticipantRow, "a" | "b" | "participants" | "title" | "departures">,
  inbox: Address,
) {
  const peers = endpoints(row),
    organizations = new Set(peers.map((p) => p.organizationId));
  const external = organizations.size > 1;
  const team =
    row.participants.length > 0 &&
    (!external || organizations.size > 2 || Boolean(row.title));
  const remote = peers.filter((p) => p.organizationId !== inbox.organizationId);
  const peer = team
    ? {
        ...row.b,
        organizationId: inbox.organizationId,
        name:
          row.title ||
          (external
            ? "Group conversation"
            : peers
                .filter((p) => p.id !== inbox.id)
                .map((p) => p.name)
                .join(", ")
                .slice(0, 254)),
      }
    : (remote.find((p) => p.kind === "group") ??
      remote[0] ??
      peers.find((p) => addressKey(p) !== addressKey(inbox)) ??
      row.b);
  return { team, external, peer, own: inbox };
}
export async function participantDetails(
  c: PoolClient,
  row: ParticipantRow,
  inbox: Address,
  a: MessageActor,
) {
  const participants = [];
  for (const endpoint of endpoints(row)) {
    const members =
      endpoint.kind === "group"
        ? (
            await c.query(
              "select platform.messaging_participant_members($1,$2::jsonb) as members",
              [row.id, JSON.stringify(endpoint)],
            )
          ).rows[0].members
        : [];
    participants.push({
      ...publicEndpoint(endpoint),
      members,
      history:
        Number(row.history_limits[addressKey(endpoint)] ?? 0) > 0
          ? "future"
          : "all",
    });
  }
  const floor = Number(row.history_limits[addressKey(inbox)] ?? 0);
  return {
    ownerId: row.group_owner ?? row.a.id, creatorId: row.a.id,
    internalGroup: row.participants.length>0 && row.participants.every(p=>p.kind==="user" && p.organizationId===row.a.organizationId),
    readOnly: !!row.departures?.[addressKey(inbox)],
    participants,
    external: new Set(endpoints(row).map((p) => p.organizationId)).size > 1,
    requests: row.participant_requests
      .filter((r) => r.status === "pending")
      .map((r) => ({
        id: r.id,
        target: publicEndpoint(r.target),
        history: r.history,
        requestedBy: r.requestedBy,
        createdAt: r.createdAt,
        canApprove:
          r.required.includes(a.organizationId) &&
          !r.approved.includes(a.organizationId),
        awaiting: r.required
          .filter((org) => !r.approved.includes(org))
          .map(
            (org) =>
              endpoints(row).find((p) => p.organizationId === org)
                ?.organizationName ?? "Company",
          ),
      })),
    events: row.participant_events
      .filter((e) => e.sequence >= floor && (!row.departures?.[addressKey(inbox)] || e.createdAt <= row.departures[addressKey(inbox)]!.leftAt))
      .map(({ sequence: _, ...e }) => e),
  };
}
async function persist(c: PoolClient, row: ParticipantRow) {
  await c.query(
    "update platform.conversations set participants=$2::jsonb,history_limits=$3::jsonb,participant_requests=$4::jsonb,participant_events=$5::jsonb,departures=$6::jsonb,updated_at=now() where id=$1",
    [
      row.id,
      JSON.stringify(row.participants),
      JSON.stringify(row.history_limits),
      JSON.stringify(row.participant_requests),
      JSON.stringify(row.participant_events),
      JSON.stringify(row.departures ?? {}),
    ],
  );
}
async function sequence(c: PoolClient, id: string) {
  return Number(
    (await c.query("select platform.messaging_join_sequence($1) as n", [id]))
      .rows[0].n,
  );
}
function admit(row: ParticipantRow, target: Address, floor: number) {
  if (endpoints(row).some((p) => addressKey(p) === addressKey(target)))
    throw new MessageFailure(409);
  if (endpoints(row).length >= 100) throw new MessageFailure(400);
  row.participants = [...(row.participants.length ? row.participants : [row.a,row.b]).filter(p=>addressKey(p)!==addressKey(target)), target];
  if(row.departures) delete row.departures[addressKey(target)];
  row.history_limits[addressKey(target)] = floor;
}
export async function addParticipants(
  c: PoolClient,
  row: ParticipantRow,
  inbox: Address,
  a: MessageActor,
  targets: Address[],
  history: "all" | "future",
  convertExternal: boolean,
) {
  const existing = endpoints(row),
    external = existing.some((p) => p.organizationId !== a.organizationId);
  if (targets.some((p) => p.kind !== "user" || !p.membershipKey))
    throw new MessageFailure(400);
  if (
    !external &&
    targets.some((p) => p.organizationId !== a.organizationId) &&
    !convertExternal
  )
    throw new MessageFailure(409);
  if (
    targets.length +
      existing.length +
      row.participant_requests.filter((r) => r.status === "pending").length >
    100
  )
    throw new MessageFailure(400);
  if (new Set(targets.map(addressKey)).size !== targets.length)
    throw new MessageFailure(400);
  const watermark = await sequence(c, row.id),
    inviterFloor = Number(row.history_limits[addressKey(inbox)] ?? 0);
  for (const target of targets) {
    if (
      existing.some((p) => addressKey(p) === addressKey(target)) ||
      row.participant_requests.some(
        (r) =>
          r.status === "pending" && addressKey(r.target) === addressKey(target),
      )
    )
      throw new MessageFailure(409);
    const floor = Math.max(inviterFloor, history === "future" ? watermark : 0);
    const required =
      target.organizationId === a.organizationId
        ? []
        : [...new Set(existing.map((p) => p.organizationId))].filter(
            (org) => org !== a.organizationId,
          );
    if (required.length) {
      row.participant_requests.push({
        id: randomUUID(),
        target,
        history,
        floor,
        requestedBy: a.name,
        requesterOrganization: a.organizationId,
        required,
        approved: [],
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    } else {
      admit(row, target, floor);
      row.participant_events.push({
        id: randomUUID(),
        text: `${a.name} added ${target.name} · ${target.organizationName}`,
        createdAt: new Date().toISOString(),
        sequence: watermark,
      });
    }
  }
  await persist(c, row);
}
export async function decideParticipant(
  c: PoolClient,
  row: ParticipantRow,
  a: MessageActor,
  requestId: string,
  approve: boolean,
) {
  const request = row.participant_requests.find((r) => r.id === requestId);
  if (!request) throw new MessageFailure(404);
  if (
    !request.required.includes(a.organizationId) ||
    request.requesterOrganization === a.organizationId
  )
    throw new MessageFailure(403);
  if (request.status !== "pending") return; // Retry is harmless.
  if (!approve) request.status = "declined";
  else {
    if (!request.approved.includes(a.organizationId))
      request.approved.push(a.organizationId);
    if (request.required.every((org) => request.approved.includes(org))) {
      const watermark = await sequence(c, row.id);
      admit(
        row,
        request.target,
        Math.max(request.floor, request.history === "future" ? watermark : 0),
      );
      request.status = "added";
      row.participant_events.push({
        id: randomUUID(),
        text: `${a.name} approved adding ${request.target.name} · ${request.target.organizationName}`,
        createdAt: new Date().toISOString(),
        sequence: watermark,
      });
    }
  }
  await persist(c, row);
}

export async function departGroup(c:PoolClient,row:ParticipantRow,inbox:Address,a:MessageActor,targetId:string,nextOwnerId?:string) {
  if(!row.participants.length || row.participants.some(p=>p.kind!=="user" || p.organizationId!==a.organizationId)) throw new MessageFailure(400);
  const owner=row.group_owner??row.a.id, members=endpoints(row);
  const target=members.find(p=>p.id===targetId);
  if(!target || row.departures?.[addressKey(inbox)]) throw new MessageFailure(409);
  const leaving=targetId===a.userId;
  if(!leaving && owner!==a.userId) throw new MessageFailure(403);
  if(!leaving && targetId===owner) throw new MessageFailure(403);
  const remaining=members.filter(p=>p.id!==targetId);
  if(leaving && owner===a.userId && remaining.length) {
    const next=remaining.find(p=>p.id===nextOwnerId);
    if(!next) throw new MessageFailure(409);
    row.group_owner=next.id;
  } else if(nextOwnerId) throw new MessageFailure(400);
  const watermark=await sequence(c,row.id), now=new Date().toISOString();
  row.participant_events.push({id:randomUUID(),text:leaving?`${a.name} left the group`:`${a.name} removed ${target.name}`,createdAt:now,sequence:watermark});
  if(leaving && owner===a.userId && remaining.length) row.participant_events.push({id:randomUUID(),text:`${remaining.find(p=>p.id===row.group_owner)!.name} is now the group owner`,createdAt:now,sequence:watermark});
  row.departures={...row.departures,[addressKey(target)]:{sequence:watermark,leftAt:now,reason:leaving?"left":"removed"}};
  // Update while the caller is still active; the restrictive policy checks the
  // old row, so an owner can atomically transfer ownership and leave.
  await c.query("update platform.conversations set group_owner=$2,departures=$3::jsonb,participant_events=$4::jsonb,updated_at=now() where id=$1",[row.id,row.group_owner??owner,JSON.stringify(row.departures),JSON.stringify(row.participant_events)]);
}
