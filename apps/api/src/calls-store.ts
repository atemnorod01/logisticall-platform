import {
  defaultVoicemailSettings,
  type VoicemailSettings,
} from "../../../packages/types/src/voicemail.js";
import type { Pool } from "pg";
import type {
  AudioCall,
  CallParty,
} from "../../../packages/types/src/calls.js";
export class CallError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export type CallActor = { userId: string; organizationId: string };
export const partyMatches = (p: CallParty, a: CallActor) =>
  p.id === a.userId && p.organizationId === a.organizationId;
export function postgresCalls(pool: Pick<Pool, "connect">) {
  async function transaction<T>(run: (rows: AudioCall[]) => T): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query("begin");
      // Serialize admission and transitions across API replicas, including crossed calls.
      await db.query("lock table platform.audio_calls in exclusive mode");
      const rows = (
        await db.query<{ data: AudioCall }>(
          "select data from platform.audio_calls",
        )
      ).rows.map((r) => r.data);
      const original = new Map(rows.map((c) => [c.id, JSON.stringify(c)]));
      const now = Date.now();
      for (const c of rows) {
        if (
          c.status !== "ended" &&
          (now - c.callerSeen > 35000 ||
            (c.status === "ringing"
              ? now - c.createdAt > (c.ringSeconds ?? 45) * 1000
              : now - c.calleeSeen > 35000))
        ) {
          c.status = "ended";
          c.endedAt = now;
          c.reason =
            c.acceptedAt || now - c.callerSeen > 35000
              ? "Connection lost"
              : "No answer";
          c.offer = "";
          c.answer = null;
        }
      }
      const result = run(rows);
      for (const c of rows)
        if (original.get(c.id) !== JSON.stringify(c)) {
          await db.query(
            "insert into platform.audio_calls values($1,$2) on conflict(id) do update set data=excluded.data",
            [c.id, JSON.stringify(c)],
          );
          if (
            c.status === "ended" &&
            c.conversationId &&
            (!original.has(c.id) ||
              JSON.parse(original.get(c.id)!).status !== "ended")
          )
            await db.query("select platform.publish_call_message($1)", [c.id]);
        }
      await db.query(
        "delete from platform.audio_calls where (data->>'createdAt')::bigint < $1 and data->>'status'='ended'",
        [Date.now() - 86400000],
      );
      await db.query("commit");
      return result;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  return {
    async preferences(userId: string): Promise<VoicemailSettings> {
      const db = await pool.connect();
      try {
        const result = await db.query<{ settings: VoicemailSettings }>(
          "select settings from platform.voicemail_settings where user_id=$1",
          [userId],
        );
        return result.rows[0]?.settings ?? { ...defaultVoicemailSettings };
      } finally {
        db.release();
      }
    },
    async savePreferences(userId: string, settings: VoicemailSettings) {
      const db = await pool.connect();
      try {
        await db.query(
          "insert into platform.voicemail_settings values($1,$2) on conflict(user_id) do update set settings=excluded.settings",
          [userId, JSON.stringify(settings)],
        );
        return settings;
      } finally {
        db.release();
      }
    },
    sync(actor: CallActor, client: string) {
      return transaction((rows) => {
        const mine = rows.filter(
          (c) => partyMatches(c.caller, actor) || partyMatches(c.callee, actor),
        );
        for (const c of mine) {
          if (partyMatches(c.caller, actor) && c.callerClient === client)
            c.callerSeen = Date.now();
          if (partyMatches(c.callee, actor) && c.calleeClient === client)
            c.calleeSeen = Date.now();
        }
        return mine
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30)
          .map((c) => ({
            ...c,
            offer:
              partyMatches(c.callee, actor) &&
              (!c.calleeClient || c.calleeClient === client)
                ? c.offer
                : "",
            answer:
              partyMatches(c.caller, actor) && c.callerClient === client
                ? c.answer
                : null,
          }));
      });
    },
    create(call: AudioCall) {
      return transaction((rows) => {
        const existing = rows.find((c) => c.id === call.id);
        if (existing) {
          if (
            existing.caller.id === call.caller.id &&
            existing.callerClient === call.callerClient
          )
            return existing;
          throw new CallError(409, "Call already exists");
        }
        const busy = (id: string) =>
          rows.some(
            (c) =>
              c.status !== "ended" && [c.caller.id, c.callee.id].includes(id),
          );
        if (busy(call.caller.id))
          throw new CallError(409, "You are already on a call.");
        if (busy(call.callee.id)) {
          call.status = "ended";
          call.reason = "Busy";
          call.endedAt = Date.now();
          call.offer = "";
        }
        rows.push(call);
        return call;
      });
    },
    action(
      actor: CallActor,
      id: string,
      client: string,
      action: "accept" | "answer" | "end",
      answer?: string,
    ) {
      return transaction((rows) => {
        const c = rows.find(
          (c) =>
            c.id === id &&
            (partyMatches(c.caller, actor) || partyMatches(c.callee, actor)),
        );
        if (!c) throw new CallError(404, "Call not found");
        const caller = partyMatches(c.caller, actor);
        if (action === "end" && c.status === "ended") return c;
        if (c.status === "ended") throw new CallError(409, "Call has ended");
        if (
          caller
            ? c.callerClient !== client
            : c.calleeClient && c.calleeClient !== client
        )
          throw new CallError(409, "Call is open on another device");
        if (action === "accept") {
          if (caller || c.status !== "ringing")
            throw new CallError(409, "Call was already answered");
          c.calleeClient = client;
          c.calleeSeen = Date.now();
          c.acceptedAt = Date.now();
          c.status = "connecting";
        } else if (action === "answer") {
          if (caller || c.status !== "connecting" || !answer)
            throw new CallError(409, "Call cannot be answered");
          c.answer = answer;
          c.status = "active";
          c.connectedAt = Date.now();
        } else {
          c.reason =
            c.status === "ringing"
              ? caller
                ? "Canceled"
                : "Declined"
              : "Call ended";
          c.status = "ended";
          c.endedAt = Date.now();
          c.offer = "";
          c.answer = null;
        }
        return c;
      });
    },
  };
}
export type CallsStore = ReturnType<typeof postgresCalls>;
