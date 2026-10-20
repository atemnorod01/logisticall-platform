import { pbxExtension } from "../../../../packages/types/src/settings";

export class MemberInviteError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}
export class MemberCreateRejected extends Error {}
type User = {
  user: string;
  email?: string | undefined;
  "user-scope"?: string | undefined;
  domain?: string | undefined;
};
export type MemberInviteInput = {
  organizationId: string;
  requestId: string;
  name: string;
  email: string;
  extension?: string;
};
export type MemberInvitation = { id: string; user_id: string };
export type MemberInviteOperation = {
  input: MemberInviteInput;
  domain: string;
  extension: string;
  stage: "reserved" | "writing" | "complete" | "cancelled";
  member?: MemberInvitation;
};
export interface MemberInviteStore {
  exclusive<T>(organizationId: string, work: () => Promise<T>): Promise<T>;
  get(key: string): Promise<MemberInviteOperation | undefined>;
  put(key: string, operation: MemberInviteOperation): Promise<void>;
  pending(
    organizationId: string,
  ): Promise<{ key: string; operation: MemberInviteOperation }[]>;
}
export interface MemberInviteProvider {
  binding(organizationId: string): Promise<{ domain: string } | undefined>;
  users(domain: string): Promise<User[]>;
  create(
    domain: string,
    input: { name: string; email: string; extension: string },
  ): Promise<void>;
}
const normalize = (email: string) => email.trim().toLowerCase();
export function suggestMemberExtension(
  users: User[],
  reserved: string[] = [],
): string | null {
  // Infer the usual width from human users, not attendants or high-numbered services.
  const human = users.filter(
    (u) =>
      normalize(u.email ?? "") &&
      normalize(u.email ?? "") !== "blank@replaceme.com" &&
      (u["user-scope"] ?? "").replace(/[\s_-]+/g, "").toLowerCase() !==
        "noportal" &&
      pbxExtension.safeParse(u.user).success,
  );
  const groups = new Map<number, number[]>();
  for (const u of human) {
    const values = groups.get(u.user.length) ?? [];
    values.push(Number(u.user));
    groups.set(u.user.length, values);
  }
  const group = [...groups].sort(
    (a, b) =>
      b[1].length - a[1].length || Math.min(...a[1]) - Math.min(...b[1]),
  )[0];
  const width = group?.[0] ?? 3,
    start = group ? Math.min(...group[1]) : 101;
  const occupied = new Set([...users.map((u) => u.user), ...reserved]);
  for (let n = start; n < 10 ** width; n++) {
    const extension = String(n).padStart(width, "0");
    if (pbxExtension.safeParse(extension).success && !occupied.has(extension))
      return extension;
  }
  return null;
}
export function memberInvitationService(
  store: MemberInviteStore,
  provider: MemberInviteProvider,
) {
  const binding = async (id: string) => {
    const value = await provider.binding(id);
    if (!value)
      throw new MemberInviteError(
        "Telephony is not enabled for this organization.",
        403,
      );
    return value;
  };
  return {
    async suggestion(id: string) {
      return store.exclusive(id, async () => {
        const current = await binding(id),
          users = await provider.users(current.domain);
        return {
          extension: suggestMemberExtension(
            users,
            (await store.pending(id)).map((r) => r.operation.extension),
          ),
        };
      });
    },
    async invite<T extends MemberInvitation>(
      input: MemberInviteInput,
      ensureMember: (previous?: MemberInvitation) => Promise<T>,
    ): Promise<T & { extension: string }> {
      return store.exclusive(input.organizationId, async () => {
        const { domain } = await binding(input.organizationId);
        let key = `${input.organizationId}:${input.requestId}`,
          op = await store.get(key);
        const pending = await store.pending(input.organizationId);
        // Reopening the form can resume an unfinished invitation for the same person.
        const unfinished = pending.find(
          (r) => normalize(r.operation.input.email) === normalize(input.email),
        );
        if (!op && unfinished) {
          key = unfinished.key;
          op = unfinished.operation;
        }
        if (op?.stage === "cancelled")
          throw new MemberInviteError("This invitation was revoked.");
        if (
          op &&
          (op.domain !== domain ||
            normalize(op.input.email) !== normalize(input.email) ||
            op.input.name !== input.name)
        )
          throw new MemberInviteError(
            "This invitation changed. Reopen the invitation form.",
          );
        let users = await provider.users(domain);
        const reserved = pending
          .filter((r) => r.key !== key)
          .map((r) => r.operation.extension);
        const extension =
          input.extension ??
          op?.extension ??
          suggestMemberExtension(users, reserved);
        if (!extension)
          throw new MemberInviteError(
            "No extension is available in this range. Choose another extension.",
          );
        pbxExtension.parse(extension);
        if (op && op.stage !== "reserved" && op.extension !== extension)
          throw new MemberInviteError(
            `This invitation is provisioning extension ${op.extension}. Retry with that extension.`,
          );
        const existing = users.find((u) => u.user === extension);
        const matches = (u: User | undefined) =>
          !!u &&
          (!u.domain || u.domain === domain) &&
          normalize(u.email ?? "") === normalize(input.email) &&
          u["user-scope"] === "Basic User";
        if (
          (existing && !(op && op.stage !== "reserved" && matches(existing))) ||
          reserved.includes(extension)
        )
          throw new MemberInviteError(
            `Extension ${extension} is already in use. Choose another extension.`,
          );
        if (
          (!op || op.stage === "reserved") &&
          users.some((u) => normalize(u.email ?? "") === normalize(input.email))
        )
          throw new MemberInviteError(
            "This email already has a PBX user. Review the existing member before creating another.",
          );
        if (!op) {
          op = {
            input: { ...input, email: normalize(input.email) },
            domain,
            extension,
            stage: "reserved",
          };
        } else if (op.extension !== extension) {
          op.extension = extension;
        }
        // IAM revalidates the pending invitation even on retries; revoked/archived users cannot be recreated.
        const member = await ensureMember(op.member);
        if (
          op.member &&
          (op.member.id !== member.id || op.member.user_id !== member.user_id)
        )
          throw new MemberInviteError("Invitation ownership changed.");
        op.member = { id: member.id, user_id: member.user_id };
        await store.put(key, op);
        if (op.stage === "complete") {
          if (!matches(existing))
            throw new MemberInviteError(
              "The saved extension changed. Review this member’s phone settings.",
            );
          return { ...member, extension };
        }
        if (op.stage === "writing") {
          if (!matches(existing))
            throw new MemberInviteError(
              "The previous extension creation is still unconfirmed. Retry to check its outcome; no duplicate will be created.",
            );
        } else {
          op.stage = "writing";
          await store.put(key, op);
          try {
            await provider.create(domain, {
              name: input.name,
              email: normalize(input.email),
              extension,
            });
          } catch (error) {
            if (error instanceof MemberCreateRejected) {
              op.stage = "reserved";
              await store.put(key, op);
              throw new MemberInviteError(
                "Extension creation was rejected. Check the extension and retry.",
              );
            }
            // A lost write response must be reconciled by reading, never blindly replayed.
            users = await provider.users(domain);
            if (!matches(users.find((u) => u.user === extension)))
              throw new MemberInviteError(
                "The member is pending, but extension creation is not confirmed. Retry to check its progress.",
              );
          }
          users = await provider.users(domain);
          if (!matches(users.find((u) => u.user === extension)))
            throw new MemberInviteError(
              "The member is pending while the extension finishes creating. Retry to verify it.",
            );
        }
        op.stage = "complete";
        await store.put(key, op);
        return { ...member, extension };
      });
    },
  };
}
