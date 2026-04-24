import { z } from "zod";

// Core lead fields common to every vertical.
// .passthrough() allows industry-specific extras (HVAC: unit_age, Moving: cubic_feet, etc.)
// without breaking validation — unknowns are forwarded to OpenClaw as-is.
export const leadPayloadSchema = z
  .object({
    name:              z.string().min(1).max(200),
    email:             z.string().email().optional(),
    phone:             z.string().max(30).optional(),
    business_name:     z.string().max(200).optional(),
    service_requested: z.string().max(500).optional(),
    message:           z.string().max(5000).optional(),
    source_url:        z.string().url().optional(),
  })
  .passthrough();

export const automationRequestSchema = z.object({
  lead: leadPayloadSchema,
});

export type AutomationRequest = z.infer<typeof automationRequestSchema>;
export type LeadPayload       = z.infer<typeof leadPayloadSchema>;
