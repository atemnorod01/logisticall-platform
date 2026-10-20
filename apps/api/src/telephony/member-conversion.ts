import { z } from "zod";
import { MemberCreateRejected } from "./member-invitation";

type Member = {
  id: string;
  name: string;
  email: string;
  status: string;
};
type User = {
  user: string;
  email?: string | undefined;
  "user-scope"?: string | undefined;
  domain?: string | undefined;
};
export type MemberConversion = {
  status: "running" | "failed" | "complete";
  members: { userId: string; name: string; email: string; extension: string }[];
  completed: string[];
  error?: string;
};
export interface MemberConversionProvider {
  domainDestinationUsers(domain: string): Promise<User[]>;
  createMemberUser(
    domain: string,
    input: { name: string; email: string; extension: string },
  ): Promise<void>;
}

const normalize = (email: string) => email.trim().toLowerCase();
const matches = (
  user: User | undefined,
  domain: string,
  email: string,
  extension: string,
) =>
  !!user &&
  user.user === extension &&
  (!user.domain || user.domain === domain) &&
  normalize(user.email ?? "") === email &&
  user["user-scope"] === "Basic User";

export function memberConversionPlan(members: Member[]): MemberConversion {
  const eligible = members.filter((member) => member.status !== "archived");
  const emails = new Set<string>();
  return {
    status: "running",
    completed: [],
    members: eligible.map((member, index) => {
      const email = z.email().parse(normalize(member.email));
      if (emails.has(email)) throw new Error(`Duplicate member email ${email}.`);
      emails.add(email);
      return {
        userId: z.string().min(1).parse(member.id),
        name: z.string().trim().min(1).max(100).parse(member.name),
        email,
        extension: String(101 + index),
      };
    }),
  };
}

export async function provisionConvertedMembers(
  domain: string,
  progress: MemberConversion,
  provider: MemberConversionProvider,
  save: (progress: MemberConversion) => Promise<void>,
) {
  progress.status = "running";
  delete progress.error;
  await save(structuredClone(progress));
  try {
    for (const member of progress.members) {
      let users = await provider.domainDestinationUsers(domain);
      const byExtension = users.find((user) => user.user === member.extension);
      const byEmail = users.find(
        (user) => normalize(user.email ?? "") === member.email,
      );
      if (!matches(byExtension, domain, member.email, member.extension)) {
        if (byExtension)
          throw new Error(`Extension ${member.extension} is already in use.`);
        if (byEmail)
          throw new Error(
            `${member.email} already has PBX extension ${byEmail.user}.`,
          );
        try {
          await provider.createMemberUser(domain, member);
        } catch (error) {
          users = await provider.domainDestinationUsers(domain);
          if (!matches(
            users.find((user) => user.user === member.extension),
            domain,
            member.email,
            member.extension,
          )) {
            if (error instanceof MemberCreateRejected) throw error;
            throw new Error(
              `PBX user ${member.extension} creation is not confirmed. Resume conversion to reconcile it.`,
            );
          }
        }
        users = await provider.domainDestinationUsers(domain);
        if (!matches(
          users.find((user) => user.user === member.extension),
          domain,
          member.email,
          member.extension,
        ))
          throw new Error(`PBX user ${member.extension} was not confirmed.`);
      }
      if (!progress.completed.includes(member.userId)) {
        progress.completed.push(member.userId);
        await save(structuredClone(progress));
      }
    }
    progress.status = "complete";
    await save(structuredClone(progress));
  } catch (error) {
    progress.status = "failed";
    progress.error = error instanceof Error ? error.message : "Member conversion failed.";
    await save(structuredClone(progress));
    throw error;
  }
  return progress;
}
