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
  disabling?: boolean;
  termination?: import("./organization-termination").OrganizationTermination;
  lifecycleHistory?: { portaoneId: string | null; netsapiensDomain: string | null; termination?: import("./organization-termination").OrganizationTermination }[];
  netsapiensProvisioning?: import("./netsapiens-provisioning-options").NetsapiensProvisioning;
  portaoneProvisioning?: PortaoneProvisioning;
  contact?: ContactProfile;
  id: string;
  name: string;
  createdAt: string;
  portaoneId: string | null;
  netsapiensDomain: string | null;
}
