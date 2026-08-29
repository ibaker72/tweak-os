import { z } from "zod";

/**
 * Wire shape for one proposal line item.
 *
 * Current clients send `one_time_price` / `monthly_price`; the legacy
 * `price` + `billing` pair (and its `secondary` amount) is still accepted
 * so an older caller keeps working. Routes normalize with
 * `normalizeServices` before computing totals or writing `services_json`,
 * so exactly one shape is ever persisted.
 */
export const proposalServiceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  one_time_price: z.number().nonnegative().nullable().optional(),
  monthly_price: z.number().nonnegative().nullable().optional(),
  // --- legacy, accepted on input only ---
  price: z.number().nonnegative().optional(),
  billing: z.enum(["one-time", "monthly"]).optional(),
  secondary: z
    .object({
      price: z.number().nonnegative(),
      billing: z.enum(["one-time", "monthly"]),
    })
    .optional(),
});

export type ProposalServiceInput = z.infer<typeof proposalServiceSchema>;
