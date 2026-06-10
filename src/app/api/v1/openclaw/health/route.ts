import { NextRequest, NextResponse } from "next/server";
import { OPENCLAW_CAPABILITIES } from "@/lib/openclaw/auth";

export const runtime = "nodejs";

function preview(value: string | undefined | null) {
  if (!value) return "";
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export async function GET(request: NextRequest) {
  const expected = process.env.OPENCLAW_API_TOKEN?.trim();
  const authHeader = request.headers.get("authorization") ?? "";
  const incoming = authHeader.replace(/^Bearer\s+/i, "").trim();

  const matches = Boolean(expected && incoming && expected === incoming);

  if (!matches) {
    return NextResponse.json(
      {
        error: "OpenClaw debug unauthorized",
        debug: {
          envExists: Boolean(expected),
          envLength: expected?.length ?? 0,
          incomingLength: incoming.length,
          envPreview: preview(expected),
          incomingPreview: preview(incoming),
          authHeaderExists: Boolean(authHeader),
          authHeaderStartsWithBearer: /^Bearer\s+/i.test(authHeader),
          matches,
        },
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    service: "tweak-build-os",
    timestamp: new Date().toISOString(),
    capabilities: OPENCLAW_CAPABILITIES,
  });
}