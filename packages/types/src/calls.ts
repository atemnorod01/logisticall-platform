export type CallParty = {
  id: string;
  organizationId: string;
  name: string;
  organizationName?: string;
};
export type AudioCall = {
  id: string;
  caller: CallParty;
  callee: CallParty;
  team?: CallParty;
  recipients?: CallParty[];
  declined?: string[];
  callerClient: string;
  calleeClient: string | null;
  status: "ringing" | "connecting" | "active" | "ended";
  offer: string;
  answer: string | null;
  createdAt: number;
  ringSeconds?: number;
  conversationId?: string;
  sourceGroupId?: string;
  connectedAt?: number;
  acceptedAt: number | null;
  endedAt: number | null;
  reason: string | null;
  callerSeen: number;
  calleeSeen: number;
};
export const liveCall = (c: AudioCall) => c.status !== "ended";

export type CallTarget = CallParty & {
  kind?: "user" | "group";
  conversationId?: string;
  groupId?: string;
};
