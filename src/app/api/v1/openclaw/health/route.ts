import { NextRequest, NextResponse } from "next/server";
import { OPENCLAW_CAPABILITIES, guard } from "@/lib/openclaw/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const check = guard(request);
  if (!check.ok) return check.response;

  return NextResponse.json({
    ok: true,
    service: "tweak-build-os",
    timestamp: new Date().toISOString(),
    capabilities: OPENCLAW_CAPABILITIES,
  });
}
