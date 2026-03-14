import { z } from "zod";

export const lifecycleStatusSchema = z.enum([
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
  "archived",
]);

export const enrichmentStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export const leadUpdateSchema = z.object({
  business_name: z.string().min(1).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  website: z.string().url().optional().or(z.literal("")),
  source: z.string().optional(),
  niche: z.string().optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  manual_notes: z.string().optional(),
});

export const leadFilterSchema = z.object({
  search: z.string().optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  enrichment_status: enrichmentStatusSchema.optional(),
  niche: z.string().optional(),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  sort_by: z
    .enum(["score", "business_name", "created_at", "updated_at"])
    .default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

export type LeadFilter = z.infer<typeof leadFilterSchema>;
