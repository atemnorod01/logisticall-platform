import { z } from "zod";
import type { PortaoneCustomerTemplate } from "./organization-template";
const scalar = z.union([z.string(), z.number()]);
const options = [
  "css",
  "nex",
  "dp",
  "location",
  "ip",
  "ex",
  "ac",
  "csdr",
  "ia",
  "nl",
  "em",
  "cc",
  "cs",
  "op",
];
const codes = [
  "call_release",
  "cs_bulk_management",
  "clir_show",
  "bypass_dial_plan",
  "huntgroup_login",
  "recording_on_dtmf",
  "recording_off",
  "barge_in_dtmf",
  "voicemail",
  "cs_individual_management",
  "dial_out",
  "spy",
  "call_park",
  "whisper_dtmf",
  "paging_prefix",
  "recording_off_dtmf",
  "clir_hide",
  "group_pickup",
  "spy_dtmf",
  "recording_on",
  "whisper",
  "huntgroup_logout",
  "barge_in",
];
const definitionSchema = z.object({
  description: z.string(),
  rule_type: z.enum(["pbx", "planOnly", "advanced"]),
  restricted: z.string(),
  usage_type: z.string(),
  rule: z.object(
    Object.fromEntries(options.map((k) => [k, scalar.optional()])),
  ),
  dial_codes: z.object(
    Object.fromEntries(codes.map((k) => [k, z.string().optional()])),
  ),
  tr_rule_to_local: z.string(),
  tr_rule_from_local: z.string(),
});
export interface DialingRuleTemplate {
  sourceRuleId: number;
  sourceName: string;
  definition: z.infer<typeof definitionSchema>;
}
export function extractDialingRuleTemplate(
  input: unknown,
  customerId: number,
  ruleId: number,
): DialingRuleTemplate {
  const source = z
    .object({
      i_dialing_rule: z.literal(ruleId),
      i_owner: z.literal(customerId),
      owner_type: z.literal("Customer"),
      name: z.string(),
    })
    .parse(input);
  return {
    sourceRuleId: source.i_dialing_rule,
    sourceName: source.name,
    definition: definitionSchema.parse(input),
  };
}
// Params for POST /DialingRule/add_dialing_rule after the new customer is created.
export function newCustomerDialingRuleParams(
  template: PortaoneCustomerTemplate,
  customerId: number,
) {
  z.number().int().positive().parse(customerId);
  if (!template.dialingRule)
    throw new Error("The shared template has no dialing-rule definition.");
  const { rule, tr_rule_to_local, tr_rule_from_local, ...definition } =
    structuredClone(template.dialingRule.definition);
  // PortaOne accepts either structured options or translation expressions, never both.
  return {
    dialing_rule_info: {
      ...definition,
      ...(definition.rule_type === "advanced"
        ? { tr_rule_to_local, tr_rule_from_local }
        : { rule }),
      name: `DR_Customer_${customerId}`,
      owner_type: "Customer",
      i_owner: customerId,
    },
  };
}
// Bind the newly created rule, rather than the source customer's rule, to customer features.
export function newCustomerServiceFeatures(
  template: PortaoneCustomerTemplate,
  newDialingRuleId: number,
) {
  z.number().int().positive().parse(newDialingRuleId);
  if (newDialingRuleId === template.dialingRule?.sourceRuleId)
    throw new Error(
      "Create a new customer-owned dialing rule before assigning features.",
    );
  const features = structuredClone(template.serviceFeatures);
  const dialing = features.find((f) => f.name === "voice_dialing");
  if (!dialing)
    throw new Error("The template is missing the voice dialing feature.");
  dialing.flag = "Y";
  dialing.attributes = dialing.attributes.filter(
    (a) => a.name !== "i_dial_rule",
  );
  dialing.attributes.push({
    name: "i_dial_rule",
    values: [String(newDialingRuleId)],
  });
  return features.map(({ flag, ...feature }) => ({
    ...feature,
    flag_value: flag,
  }));
}
