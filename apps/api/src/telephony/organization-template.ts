import {
  providerProfileSchema,
  type ProviderProfile,
} from "./organization-profile";
import type { Organization } from "./model";

export interface PortaoneCustomerTemplate {
  pbx?: import("./portaone-provisioning").PbxTemplate | undefined;
  dialingRule?: import("./dialing-rule-template").DialingRuleTemplate;
  sourceCustomerId: string;
  sourceName: string;
  createdAt: string;
  settings: ProviderProfile["settings"];
  serviceFeatures: ProviderProfile["serviceFeatures"];
  perCustomerBindings: Array<{
    feature: string;
    attribute: string;
    action: "create-or-map";
  }>;
}
export function customerTemplate(
  source: Organization,
  profile: ProviderProfile,
): PortaoneCustomerTemplate {
  const data = providerProfileSchema.parse(profile);
  return {
    sourceCustomerId: source.portaoneId!,
    sourceName: source.name,
    createdAt: new Date().toISOString(),
    settings: data.settings,
    serviceFeatures: data.serviceFeatures.map((feature) => ({
      ...feature,
      attributes: feature.attributes.filter(
        (a) => !(feature.name === "voice_dialing" && a.name === "i_dial_rule"),
      ),
    })),
    // A new customer's rule must be created/mapped, never copied as the source customer's ID.
    perCustomerBindings: [
      {
        feature: "voice_dialing",
        attribute: "i_dial_rule",
        action: "create-or-map",
      },
    ],
  };
}
