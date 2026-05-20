import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { automationRequestSchema } from "@/lib/validators/automation";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogStatus = "success" | "failed" | "rejected";

interface SiteConfig {
  id: string;
  domain: string;
  client_secret: string;
  openclaw_skill_id: string;
  target_email: string;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

interface AutomationLogInsert {
  site_config_id?: string;
  domain?: string;
  status: LogStatus;
  error_message?: string;
  payload?: unknown;
  openclaw_response?: unknown;
  ip_address?: string;
}

async function log(params: AutomationLogInsert) {
  // Fire-and-forget — never let a logging failure affect the response.
  // The cast is needed because no generated Supabase types are present;
  // automation_logs is typed as `never` without them. AutomationLogInsert
  // narrows the call site, so the cast is just to satisfy the SDK overload.
  try {
    await createServiceClient()
      .from("automation_logs")
      .insert(params as unknown as never);
  } catch (err) {
    console.error("[automate] log write failed:", err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/automate
// ---------------------------------------------------------------------------
// Headers:  x-tweak-api-key  — per-site API key stored in site_configs
// Body:     { lead: LeadPayload }
//
// Flow:
//   1. Validate API key header is present
//   2. Parse + validate request body with Zod
//   3. Look up site_configs by key (service role bypasses RLS)
//   4. Forward lead to OpenClaw skill for that site
//   5. Log result to automation_logs (success / failed / rejected)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  // 1. API key presence check
  const apiKey = request.headers.get("x-tweak-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  // 2. Body validation
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = automationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // 3. Resolve site config
  const supabase = createServiceClient();
  const { data: config, error: dbError } = await supabase
    .from("site_configs")
    .select("id, domain, client_secret, openclaw_skill_id, target_email, is_active")
    .eq("client_secret", apiKey)
    .eq("is_active", true)
    .single<SiteConfig>();

  if (dbError || !config) {
    await log({ status: "rejected", error_message: "Invalid or inactive API key", ip_address: ip });
    // Deliberately vague — don't reveal whether the key exists but is inactive
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 4. Validate OpenClaw master key is configured
  const openclawKey = process.env.OPENCLAW_MASTER_KEY;
  if (!openclawKey) {
    console.error("[automate] OPENCLAW_MASTER_KEY is not set");
    await log({
      site_config_id: config.id,
      domain: config.domain,
      status: "failed",
      error_message: "Automation service misconfigured — missing master key",
      ip_address: ip,
    });
    return NextResponse.json(
      { error: "Automation service temporarily unavailable" },
      { status: 503 }
    );
  }

  // 5. Forward to OpenClaw
  // Endpoint: POST https://api.clawhub.ai/v1/skills/{skill_id}/run
  // Adjust the URL shape here if the OpenClaw API path differs.
  const openclawEndpoint =
    process.env.OPENCLAW_API_BASE_URL ?? "https://api.clawhub.ai";

  let openclawRes: Response;
  let openclawData: unknown;

  try {
    openclawRes = await fetch(
      `${openclawEndpoint}/v1/skills/${config.openclaw_skill_id}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openclawKey}`,
        },
        body: JSON.stringify({
          target_email: config.target_email,
          lead: parsed.data.lead,
          metadata: {
            source_domain: config.domain,
            submitted_at: new Date().toISOString(),
          },
        }),
      }
    );

    openclawData = await openclawRes.json().catch(() => null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    console.error("[automate] OpenClaw request failed:", message);
    await log({
      site_config_id: config.id,
      domain: config.domain,
      status: "failed",
      error_message: message,
      payload: parsed.data.lead,
      ip_address: ip,
    });
    return NextResponse.json(
      { error: "Automation service unavailable — please try again" },
      { status: 502 }
    );
  }

  if (!openclawRes.ok) {
    console.error(
      `[automate] OpenClaw returned HTTP ${openclawRes.status} for skill ${config.openclaw_skill_id}:`,
      openclawData
    );
    await log({
      site_config_id: config.id,
      domain: config.domain,
      status: "failed",
      error_message: `OpenClaw HTTP ${openclawRes.status}`,
      payload: parsed.data.lead,
      openclaw_response: openclawData,
      ip_address: ip,
    });
    return NextResponse.json(
      { error: "Failed to trigger automation" },
      { status: 502 }
    );
  }

  // 6. Log success and respond
  await log({
    site_config_id: config.id,
    domain: config.domain,
    status: "success",
    payload: parsed.data.lead,
    openclaw_response: openclawData,
    ip_address: ip,
  });

  return NextResponse.json(
    { success: true, message: "Lead submitted successfully" },
    { status: 200 }
  );
}
