import type { ContactProfile } from "./organization-profile";
export interface PortaoneProvisioning {
  status: "running" | "failed" | "complete";
  step: string;
  customerName: string;
  pendingCreate?: string;
  pendingAliases?: string[];
  dialingRuleId?: number;
  accountId?: number;
  aliases: string[];
  error?: string;
}
export interface Organization {
  /** Recorded only by the reviewed existing-PBX import, never by browser input. */
  adoption?: {
    status: 'verified';
    legacyOrganizationId: string;
    customerId: string;
    domain: string;
    customerReference: string | null;
    masterAccountId: number;
    ipAliases: string[];
    attendant: '9999';
    verifiedAt: string;
  };
  disabling?: boolean;
  termination?: import("./organization-termination").OrganizationTermination;
  lifecycleHistory?: { portaoneId: string | null; netsapiensDomain: string | null; termination?: import("./organization-termination").OrganizationTermination }[];
  netsapiensProvisioning?: import("./netsapiens-provisioning-options").NetsapiensProvisioning;
  memberConversion?: import("./member-conversion").MemberConversion;
  portaoneProvisioning?: PortaoneProvisioning;
  contact?: ContactProfile;
  id: string;
  name: string;
  createdAt: string;
  portaoneId: string | null;
  netsapiensDomain: string | null;
}
