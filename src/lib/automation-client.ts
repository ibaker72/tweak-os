/**
 * automation-client.ts — Tweak & Build Automation Hub client utility
 *
 * COPY THIS FILE into any client site repo (HVAC, Moving, etc.) at lib/automation.ts
 * and set the two environment variables below.
 *
 * Required env vars in the CLIENT repo's .env.local:
 *   AUTOMATION_HUB_URL=https://app.tweakandbuild.com      # the Hub origin
 *   AUTOMATION_API_KEY=tweak_live_xxxxxxxxxxxxxxxxxxxx     # your site's secret key
 *
 * IMPORTANT: AUTOMATION_API_KEY must NOT be prefixed with NEXT_PUBLIC_.
 * Call triggerAutomation() only from:
 *   - A Next.js Server Action  (app/actions/contact.ts)
 *   - A Next.js API route      (app/api/contact/route.ts)
 *   - Any Node.js server process
 *
 * Never call it directly from a client component — the API key would be
 * exposed in the browser bundle.
 */

const HUB_URL =
  (process.env.AUTOMATION_HUB_URL ?? "https://app.tweakandbuild.com").replace(
    /\/$/,
    ""
  );

const API_KEY = process.env.AUTOMATION_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Common lead fields. Add vertical-specific extras as needed — they'll be
 *  forwarded to OpenClaw transparently via the Hub's schema (.passthrough()). */
export interface LeadData {
  name:               string;
  email?:             string;
  phone?:             string;
  business_name?:     string;
  service_requested?: string;
  message?:           string;
  source_url?:        string;
  [key: string]:      unknown; // vertical-specific extras (unit_age, cubic_feet, etc.)
}

export interface AutomationResult {
  success:  boolean;
  message?: string;
  error?:   string;
}

// ---------------------------------------------------------------------------
// triggerAutomation
// ---------------------------------------------------------------------------

export async function triggerAutomation(lead: LeadData): Promise<AutomationResult> {
  if (!API_KEY) {
    throw new Error(
      "[automation] AUTOMATION_API_KEY is not set. " +
      "Add it to .env.local and make sure you're calling this from server-side code."
    );
  }

  let res: Response;
  try {
    res = await fetch(`${HUB_URL}/api/v1/automate`, {
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "x-tweak-api-key": API_KEY,
      },
      body: JSON.stringify({ lead }),
      // Abort after 10s so a slow Hub doesn't hang the user's form submit
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { success: false, error: message };
  }

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;

  if (!res.ok) {
    return {
      success: false,
      error: (data.error as string | undefined) ?? `Hub returned HTTP ${res.status}`,
    };
  }

  return {
    success: true,
    message: (data.message as string | undefined) ?? "Submitted",
  };
}

// ---------------------------------------------------------------------------
// Usage example (Server Action)
// ---------------------------------------------------------------------------
//
// "use server";
// import { triggerAutomation } from "@/lib/automation";
//
// export async function submitContactForm(formData: FormData) {
//   const result = await triggerAutomation({
//     name:               formData.get("name") as string,
//     email:              formData.get("email") as string,
//     phone:              formData.get("phone") as string,
//     service_requested:  formData.get("service") as string,
//     message:            formData.get("message") as string,
//     source_url:         "https://gopro-hvac.com/contact",
//   });
//
//   if (!result.success) throw new Error(result.error);
//   return { ok: true };
// }
