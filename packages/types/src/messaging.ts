import { z } from "zod";
export const addressSchema = z.object({
  kind: z.enum(["user", "group"]),
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string().min(1).max(254),
  organizationName: z.string().min(1).max(254),
  membershipKey: z.string().max(100).optional(),
});
export type Address = z.infer<typeof addressSchema>;
export const publicAddress = addressSchema.omit({ membershipKey: true });
export const conversationIdentity = z.object({
  contactName: z.string().nullable(),
  presence: z.enum(["available", "away", "busy", "offline", "unknown"]),
  dot: z.string().nullable(),
  mc: z.string().nullable(),
  inNetwork: z.boolean(),
});
export const attachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mime: z.string(),
  size: z.number(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const conversationSchema = z.object({
  readOnly: z.boolean().optional(),
  systemEvents: z.array(z.object({id:z.string(),text:z.string(),createdAt:z.string()})).optional(),
  kind: z.enum(["direct", "team"]).optional(),
  title: z.string().optional(),
  external: z.boolean().optional(),
  participants: z.array(publicAddress).optional(),
  identity: conversationIdentity.optional(),
  hasMessages: z.boolean().optional(),
  id: z.uuid(),
  peer: publicAddress,
  inbox: publicAddress,
  updatedAt: z.string(),
  preview: z.string(),
  unread: z.number().int().nonnegative(),
  done: z.boolean(),
  assignedTo: z.uuid().nullable(),
  assignedName: z.string().nullable(),
  version: z.number().int(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export const internalCommentSchema = z.object({
  senderKey: z.string().optional(),
  id: z.uuid(),
  sequence: z.number().int(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
  own: z.boolean(),
  deletedAt: z.string().nullable(),
});
export type InternalComment = z.infer<typeof internalCommentSchema>;
export const replyPreviewSchema = z.object({
  body: z.string(), deleted: z.boolean(), attachments: z.array(attachmentSchema),
});
export const callEventSchema = z.object({
  sourceTeamName: z.string().optional(),
  voicemailId:z.uuid().optional(),
  viewerRole:z.enum(["caller","callee","observer"]).optional(),
  id:z.uuid(), callerId:z.uuid(), calleeId:z.uuid(), callerName:z.string(), calleeName:z.string(),
  outcome:z.enum(["completed","unanswered"]), reason:z.string(), durationSeconds:z.number().nonnegative(),
});
export const messageSchema = z.object({
  callEvent: callEventSchema.nullable().optional(),
  senderPresence: z.enum(["available", "away", "busy", "offline", "unknown"]).optional(),
  replyPreview: replyPreviewSchema.nullable().default(null),
  internalComments: z.array(internalCommentSchema).default([]),
  own: z.boolean().optional(),
  senderKey: z.string().optional(),
  rich: z.string().default(""),
  editedAt: z.string().nullable().default(null),
  deletedAt: z.string().nullable().default(null),
  replyTo: z.string().nullable().default(null),
  threadRoot: z.string().nullable().default(null),
  forwardedFrom: z.string().nullable().default(null),
  attachments: z.array(attachmentSchema).default([]),
  reactions: z
    .array(
      z.object({ emoji: z.string(), count: z.number(), mine: z.boolean() }),
    )
    .default([]),
  receipts: z
    .array(z.object({ name: z.string(), read: z.boolean() }))
    .default([]),
  id: z.uuid(),
  sequence: z.number().int(),
  body: z.string(),
  createdAt: z.string(),
  outgoing: z.boolean(),
  internal: z.boolean(),
  senderName: z.string(),
  actorName: z.string().nullable(),
});
export type Message = z.infer<typeof messageSchema>;
export const conversationPage = z.object({
  conversations: z.array(conversationSchema),
  nextOffset: z.number().nullable(),
});
export const messagePage = z.object({
  identityVersion: z.string().default(""),
  typing: z.boolean().default(false),
  typingExpiresAt: z.string().nullable().default(null),
  messages: z.array(messageSchema),
  hasMore: z.boolean(),
});
export const createConversation = z
  .object({
    target: z
      .object({
        kind: z.enum(["user", "group"]),
        id: z.uuid(),
        organizationId: z.uuid(),
        email: z.email().optional(),
      })
      .strict(),
    groupId: z.uuid().optional(),
  })
  .strict();
export const sendMessage = z
  .object({
    voicemailFor:z.uuid().optional(),
    id: z.uuid(),
    body: z.string().trim().max(20000),
    rich: z.string().max(100000).default(""),
    internal: z.boolean().default(false),
    replyTo: z.uuid().nullable().default(null),
    forwardedFrom: z.uuid().nullable().default(null),
    attachments: z.array(z.uuid()).max(20).default([]),
  })
  .strict()
  .refine(
    (v) => v.body.length > 0 || v.attachments.length > 0,
    "Message is empty",
  );
export const editMessage = z
  .object({
    body: z.string().trim().max(20000),
    rich: z.string().max(100000).default(""),
  })
  .strict();
export const teamConversation = z
  .object({
    title: z.string().trim().max(200),
    recipients: z.array(z.uuid()).min(2).max(100),
  })
  .strict();
export const attachmentInput = z
  .object({
    filename: z.string().min(1).max(200),
    mime: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/webm",
      "audio/wav",
      "video/mp4",
      "video/webm",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain",
    ]),
    size: z.number().int().positive().max(26214400),
  })
  .strict();
export const updateConversation = z
  .object({
    version: z.number().int().positive(),
    done: z.boolean().optional(),
    assignedTo: z.uuid().nullable().optional(),
  })
  .strict();

export const addParticipantsInput = z.object({
 targets:z.array(z.object({id:z.uuid(),organizationId:z.uuid(),email:z.email().optional()}).strict()).min(1).max(20),
 history:z.enum(["all","future"]),convertExternal:z.boolean().default(false)
}).strict();
export const participantDetailsSchema=z.object({
 ownerId:z.string().nullable().default(null), creatorId:z.string().nullable().default(null), internalGroup:z.boolean().default(false), readOnly:z.boolean().default(false),
 external:z.boolean(),
 participants:z.array(publicAddress.extend({presence:conversationIdentity.shape.presence.optional(),history:z.enum(["all","future"]),members:z.array(z.object({id:z.uuid(),name:z.string(),presence:conversationIdentity.shape.presence.optional()}))})),
 requests:z.array(z.object({id:z.uuid(),target:publicAddress,history:z.enum(["all","future"]),requestedBy:z.string(),createdAt:z.string(),canApprove:z.boolean(),awaiting:z.array(z.string())})),
 events:z.array(z.object({id:z.uuid(),text:z.string(),createdAt:z.string()}))
});
export type ParticipantDetails=z.infer<typeof participantDetailsSchema>;

export const globalSearchInput = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(["all", "messages", "files", "people"]).default("all"),
  inbox: z.union([z.literal("all"), z.literal("mine"), z.uuid()]).default("all"),
  company: z.uuid().optional(),
  sender: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  beforeDate: z.iso.datetime().optional(),
  beforeKey: z.string().max(100).optional(),
}).strict().refine(v => Boolean(v.beforeDate) === Boolean(v.beforeKey), "Invalid cursor")
  .refine(v => !v.from || !v.to || v.from < v.to, "Invalid date range");
export type GlobalSearchInput = z.infer<typeof globalSearchInput>;
export const globalSearchHit = z.object({
  key: z.string(), kind: z.enum(["messages", "files", "people"]),
  conversation: conversationSchema, messageId: z.uuid().nullable(),
  commentId: z.uuid().nullable(), author: z.string(), authorId: z.uuid(),
  text: z.string(), createdAt: z.string(), internal: z.boolean(),
});
export type GlobalSearchHit = z.infer<typeof globalSearchHit>;
export const globalSearchPage = z.object({
  results: z.array(globalSearchHit),
  next: z.object({beforeDate:z.string(),beforeKey:z.string()}).nullable(),
  companies: z.array(z.object({id:z.string(),name:z.string()})),
  senders: z.array(z.object({id:z.string(),name:z.string()})),
});
