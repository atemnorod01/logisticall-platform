import { z } from "zod";

export const numberSearch = z
  .object({
    mode: z.enum(["areaCode", "cityState", "rateCenter", "tollFree"]),
    countryCodeA3: z.enum(["USA", "CAN"]).default("USA"),
    areaCode: z
      .string()
      .regex(/^[2-9]\d{2}$/)
      .optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(40).optional(),
    rateCenter: z.string().trim().min(1).max(100).optional(),
    quantity: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).max(4950).default(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.mode === "areaCode" && !v.areaCode) ||
      (v.mode === "cityState" && (!v.city || !v.state)) ||
      (v.mode === "rateCenter" && (!v.rateCenter || !v.state))
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete the search criteria.",
      });
  });
export const availableNumber = z.object({
  phone_number: z.string().regex(/^\+1[2-9]\d{9}$/),
  display_number: z.string().max(40),
  area_code: z.string().regex(/^[2-9]\d{2}$/),
  city: z.string().max(100).nullable(),
  state: z.string().max(100).nullable(),
  rate_center: z.string().max(100).nullable(),
  number_type: z.enum(["LOCAL", "TOLL_FREE"]),
});
export const numberSearchResult = z.object({
  items: z.array(availableNumber).max(50),
  hasMore: z.boolean(),
});
export const numberPurchase = z
  .object({
    requestId: z.uuid(),
    confirmed: z.literal(true),
    numbers: z.array(availableNumber).min(1).max(50),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.numbers.map((n) => n.phone_number)).size === v.numbers.length,
    "Choose unique numbers.",
  );
export const numberContext = z.object({
  configured: z.boolean(),
  purchasingEnabled: z.boolean(),
  demo: z.boolean(),
});
export const numberCoverage = z.object({
  items: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        hint: z.string().optional(),
        hasRegions: z.boolean().optional(),
      }),
    )
    .max(20000),
});
export const numberPage = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export const numberOrder = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  reference: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum([
    "DRAFT",
    "SUBMITTING",
    "SUBMITTED",
    "PROCESSING",
    "COMPLETE",
    "PARTIAL",
    "ERROR",
    "REVIEW_REQUIRED",
  ]),
  active: z.boolean(),
  attention: z.boolean(),
  numbers: z.array(
    z.object({
      number: z.string(),
      displayNumber: z.string(),
      status: z.string(),
      purchase: z.enum(["pending", "complete", "failed", "review"]),
      routing: z.enum(["pending", "complete", "failed", "not_required"]),
    }),
  ),
});
export const numberOrders = z.object({
  items: z.array(numberOrder),
  total: z.number().int().nonnegative(),
});
export type AvailableNumber = z.infer<typeof availableNumber>;
export type NumberSearch = z.infer<typeof numberSearch>;
export type NumberPurchase = z.infer<typeof numberPurchase>;
export type NumberOrder = z.infer<typeof numberOrder>;
export type NumberContext = z.infer<typeof numberContext>;
