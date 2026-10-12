import type { Conversation } from "../../../packages/types/src/messaging.js";
export function isIndividualConversation(c: Conversation) {
  return c.kind !== "team" && c.peer.kind === "user";
}
export function conversationOrganization(c: Conversation) {
  return isIndividualConversation(c) ? c.peer.organizationName : "";
}
export function conversationTitle(c: Conversation, organizationId: string) {
  return isIndividualConversation(c) || c.peer.organizationId === organizationId
    ? c.peer.name
    : c.peer.organizationName;
}
export function conversationContact(c: Conversation, organizationId: string) {
  if (c.peer.organizationId === organizationId) return "";
  if (c.peer.kind === "user") return c.identity?.contactName ?? c.peer.name;
  return c.identity?.contactName ?? "";
}
export function companyIdentifiers(c: Conversation) {
  return [
    c.identity?.dot ? `DOT ${c.identity.dot}` : "",
    c.identity?.mc ? `MC ${c.identity.mc}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function conversationGroup(c: Conversation, organizationId: string) {
  return c.peer.organizationId !== organizationId && c.peer.kind === "group" ? c.peer.name : "";
}
