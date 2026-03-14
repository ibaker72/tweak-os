import { z } from "zod";

export const csvLeadRowSchema = z.object({
  business_name: z
    .string()
    .min(1, "Business name is required")
    .transform((v) => v.trim()),
  city: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  state: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  website: z
    .string()
    .optional()
    .transform((v) => {
      if (!v?.trim()) return undefined;
      const trimmed = v.trim();
      // Auto-prefix https if missing
      if (trimmed && !trimmed.startsWith("http")) {
        return `https://${trimmed}`;
      }
      return trimmed;
    }),
  source: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  niche: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
});

export type ValidatedCsvRow = z.infer<typeof csvLeadRowSchema>;
