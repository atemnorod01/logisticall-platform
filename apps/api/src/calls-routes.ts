import { voicemailSettings } from "../../../packages/types/src/voicemail.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Address } from "../../../packages/types/src/messaging.js";
import { CallError, type CallActor, type CallsStore } from "./calls-store.js";
import type { PresenceStore } from "./presence.js";
import type { iamMessaging } from "./iam.js";
export function callsRoutes(
  app: FastifyInstance,
  deps: {
    store?: CallsStore | undefined;
    prepareConversation?: (
      token: string,
      actor: CallActor,
      caller: Address,
      callee: Address,
    ) => Promise<string>;
    presence?: PresenceStore | undefined;
    directory: ReturnType<typeof iamMessaging>;
    resolveTarget?: (
      token: string,
      actor: CallActor,
      target: { id: string; organizationId: string },
      source: { conversationId: string; groupId?: string | undefined },
    ) => Promise<Address>;
    iceServers?: RTCIceServer[] | undefined;
    iceServersFor?: (userId: string) => Promise<RTCIceServer[]>;
    authorize(
      req: FastifyRequest,
      org: string,
    ): Promise<{ actor: CallActor; token: string }>;
  },
) {
  const base = "/v1/organizations/:organizationId/calls";
  const description = z
    .string()
    .min(1)
    .max(24000)
    .refine(
      (s) => s.includes("m=audio") && !s.includes("m=video"),
      "Audio required",
    );
  const target = z.object({ id: z.uuid(), organizationId: z.uuid() });
  const source = z
    .object({ conversationId: z.uuid(), groupId: z.uuid().optional() })
    .optional();
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("preferences"), client: z.uuid() }),
    z.object({
      action: z.literal("savePreferences"),
      client: z.uuid(),
      settings: voicemailSettings,
    }),
    z.object({
      action: z.literal("voicemail"),
      client: z.uuid(),
      target,
      source,
    }),
    z.object({ action: z.literal("sync"), client: z.uuid() }),
    z.object({ action: z.literal("review"), client: z.uuid(), before: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }),
    z.object({
      action: z.literal("create"),
      client: z.uuid(),
      id: z.uuid(),
      target: z.object({ id: z.uuid(), organizationId: z.uuid() }),
      offer: description,
      source: z
        .object({ conversationId: z.uuid(), groupId: z.uuid().optional() })
        .optional(),
    }),
    z.object({
      action: z.enum(["accept", "end"]),
      client: z.uuid(),
      id: z.uuid(),
    }),
    z.object({
      action: z.literal("answer"),
      client: z.uuid(),
      id: z.uuid(),
      answer: description,
    }),
  ]);
  app.post(base, { bodyLimit: 2900000 }, async (req, reply) => {
    const org = z
      .object({ organizationId: z.uuid() })
      .parse(req.params).organizationId;
    const data = input.parse(req.body);
    const { actor, token } = await deps.authorize(req, org);
    if (!deps.store)
      return reply.code(503).send({ message: "Calling is unavailable" });
    reply.header("Cache-Control", "no-store");
    try {
      if (data.action === "preferences")
        return { settings: await deps.store.preferences(actor.userId) };
      if (data.action === "savePreferences") {
        const greeting = data.settings.greeting;
        if (greeting) {
          const bytes = Buffer.from(greeting.data, "base64");
          const valid =
            greeting.mime === "audio/webm"
              ? bytes
                  .subarray(0, 4)
                  .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
              : greeting.mime === "audio/ogg"
                ? bytes.subarray(0, 4).toString() === "OggS"
                : bytes.subarray(4, 8).toString() === "ftyp";
          if (
            !valid ||
            bytes.length > 2 * 1024 * 1024 ||
            bytes.toString("base64") !== greeting.data
          )
            throw new CallError(
              400,
              "Invalid greeting audio. Record a new greeting.",
            );
        }
        return {
          settings: await deps.store.savePreferences(
            actor.userId,
            data.settings,
          ),
        };
      }
      if (data.action === "voicemail") {
        if (data.source && !deps.resolveTarget)
          throw new CallError(503, "Conversation calling is unavailable.");
        const callee =
          data.source && deps.resolveTarget
            ? await deps.resolveTarget(token, actor, data.target, data.source)
            : await deps.directory.resolve(token, org, data.target);
        return { settings: await deps.store.preferences(callee.id) };
      }
      if (data.action === "review") { await deps.store.review(actor, data.before); return { unread: await deps.store.unread(actor) }; }
      if (data.action === "sync")
        return {
          calls: await deps.store.sync(actor, data.client),
          unread: await deps.store.unread(actor),
          iceServers: deps.iceServersFor ? await deps.iceServersFor(actor.userId) : deps.iceServers ?? [],
        };
      if (data.action === "create") {
        if (data.source && !deps.resolveTarget)
          throw new CallError(503, "Conversation calling is unavailable.");
        if (data.target.id === actor.userId)
          throw new CallError(400, "Choose another user");
        const [callee, caller] = await Promise.all([
          data.source && deps.resolveTarget
            ? deps.resolveTarget(token, actor, data.target, data.source)
            : deps.directory.resolve(token, org, data.target),
          deps.directory.resolve(token, org, {
            id: actor.userId,
            organizationId: org,
          }),
        ]);
        const statuses = await deps.presence?.read(callee.organizationId, [
          callee.id,
        ]);
        if (!statuses)
          throw new CallError(503, "Presence service is unavailable.");
        const unavailable = !["available", "away"].includes(
          statuses[callee.id] ?? "",
        );
        const conversationId =
          data.source?.conversationId ??
          (await deps.prepareConversation?.(token, actor, caller, callee));
        const preferences = await deps.store.preferences(callee.id);
        const now = Date.now();
        const call = await deps.store.create({
          id: data.id,
          caller: {
            id: caller.id,
            organizationId: org,
            name: caller.name,
            organizationName: caller.organizationName,
          },
          callee: {
            id: callee.id,
            organizationId: callee.organizationId,
            name: callee.name,
            organizationName: callee.organizationName,
          },
          callerClient: data.client,
          calleeClient: null,
          status: unavailable ? "ended" : "ringing",
          ...(conversationId ? { conversationId } : {}),
          ...(data.source?.groupId
            ? { sourceGroupId: data.source.groupId }
            : {}),
          offer: unavailable ? "" : data.offer,
          answer: null,
          createdAt: now,
          ringSeconds: preferences.ringSeconds,
          acceptedAt: null,
          endedAt: unavailable ? now : null,
          reason: unavailable ? "Unavailable" : null,
          callerSeen: now,
          calleeSeen: now,
        });
        if (call.status === "ended")
          throw new CallError(
            409,
            "This user is unavailable.",
            "recipient_unavailable",
          );
        return { call };
      }
      return {
        call: await deps.store.action(
          actor,
          data.id,
          data.client,
          data.action,
          data.action === "answer" ? data.answer : undefined,
        ),
      };
    } catch (e) {
      if (e instanceof CallError)
        return reply
          .code(e.statusCode)
          .send({ message: e.message, ...(e.code ? { code: e.code } : {}) });
      throw e;
    }
  });
}
