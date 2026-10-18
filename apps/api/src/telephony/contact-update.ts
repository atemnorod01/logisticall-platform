import { z } from "zod";
import {
  contactFields,
  contactProfileSchema,
  type ContactProfile,
} from "./organization-profile";

const text = z.string().trim().max(250);
export const editableContactSchema = z
  .object({
    companyName: text.min(1, "Company name is required."),
    firstName: text,
    lastName: text,
    contactPerson: text,
    phone: z.string().trim().max(64),
    email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (v) => !v || z.string().email().safeParse(v).success,
        "Enter a valid email address.",
      ),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (v) => !v || /^[A-Z]{2}$/.test(v),
        "Use a two-letter country code, such as US or CA.",
      ),
    addressLine1: text,
    addressLine2: text,
    city: text,
    state: text,
    postalCode: z
      .string()
      .trim()
      .max(10)
      .refine(
        (v) => !v || /^[A-Za-z0-9 -]{2,10}$/.test(v),
        "Use 2–10 letters, digits, spaces or hyphens for the postal code.",
      ),
  })
  .strict();
