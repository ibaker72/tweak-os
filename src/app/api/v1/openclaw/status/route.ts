import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OPENCLAW_CAPABILITIES } from "@/lib/openclaw/auth";

export const runtime = "nodejs";

/**
 * Settings-page status check. Reads the user's normal Supabase session
 * (cookies) so only authenticated UI can see whether the OpenClaw token
 * is configured. The actual token value is NEVER returned — we only
 * report a boolean.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configured = Boolean(process.env.OPENCLAW_API_TOKEN);

  return NextResponse.json({
    ok: true,
    connected: configured,
    capabilities: OPENCLAW_CAPABILITIES,
    base_path: "/api/v1/openclaw",
  });
}
