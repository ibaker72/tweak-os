import { z } from "zod";

export const lifecycleStatusSchema = z.enum([
  "new",
  "enriched",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "not_a_fit",
  "archived",
  "deleted",
]);

export const enrichmentStatusSchema = z.enum([
  "pending",
  "crawling",
  "complete",
  "failed",
]);

export const leadViewSchema = z.enum(["active", "archived", "deleted", "all"]);

export const ALLOWED_PER_PAGE = [25, 50, 100, 250] as const;
export type AllowedPerPage = (typeof ALLOWED_PER_PAGE)[number];

const perPageSchema = z.coerce
  .number()
  .int()
  .refine((n) => (ALLOWED_PER_PAGE as readonly number[]).includes(n), {
    message: "per_page must be one of 25, 50, 100, 250",
  })
  .default(50);

export const leadUpdateSchema = z.object({
  business_name: z.string().min(1).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  website: z.string().url().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  source: z.string().optional(),
  niche: z.string().optional(),
  category: z.string().optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  manual_notes: z.string().optional(),
  score: z.number().int().min(0).max(100).optional(),
});

export const leadFilterSchema = z.object({
  search: z.string().optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
  enrichment_status: enrichmentStatusSchema.optional(),
  niche: z.string().optional(),
  industry: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  tech_stack: z.string().optional(),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  max_score: z.coerce.number().int().min(0).max(100).optional(),
  view: leadViewSchema.default("active"),
  page: z.coerce.number().int().min(1).default(1),
  per_page: perPageSchema,
  sort_by: z
    .enum(["score", "business_name", "created_at", "updated_at", "lifecycle_status", "city", "state", "niche"])
    .default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

export type LeadFilter = z.infer<typeof leadFilterSchema>;
export type LeadView = z.infer<typeof leadViewSchema>;

// Single-lead state action — used by both single + bulk endpoints.
export const leadActionSchema = z.enum([
  "archive",
  "restore",
  "soft_delete",
  "mark_contacted",
]);
export type LeadAction = z.infer<typeof leadActionSchema>;
