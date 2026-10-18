import type { Organization } from "./model";
import type { PortaoneCustomerTemplate } from "./organization-template";
export interface Store {
  organizations(): Promise<Organization[]>;
  addOrganization(row: Organization): Promise<void>;
  portaoneCustomerTemplate(): Promise<PortaoneCustomerTemplate | undefined>;
}
