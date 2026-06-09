import { z } from "zod";

const optionalTrimmed = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v == null ? undefined : v.trim() || undefined));

export const csvLeadRowSchema = z.object({
  business_name: z.preprocess(
    (v) => (v == null ? "" : v),
    z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, "Business name is required")
  ),
  city: optionalTrimmed,
  state: optionalTrimmed,
  website: z
    .string()
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return undefined;
      const trimmed = v.trim();
      if (!trimmed) return undefined;
      if (!/^https?:\/\//i.test(trimmed)) {
        return `https://${trimmed}`;
      }
      return trimmed;
    }),
  phone: optionalTrimmed,
  email: optionalTrimmed,
  source: optionalTrimmed,
  niche: optionalTrimmed,
  industry: optionalTrimmed,

  // NJ Business Records fields
  external_id: optionalTrimmed,
  entity_type: optionalTrimmed,
  entity_status: optionalTrimmed,
  registered_agent: optionalTrimmed,
  source_filing_date: optionalTrimmed,
  import_notes: optionalTrimmed,

  // Address fields used by NJ registered-agent address mapping
  address: optionalTrimmed,
  zip: optionalTrimmed,
});

export type ValidatedCsvRow = z.infer<typeof csvLeadRowSchema>;
