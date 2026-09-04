import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// This file is the Next.js middleware. Next 16 renamed `middleware.ts` to
// `proxy.ts`; both filenames are recognised, but having both present is a hard
// build error ("Please use ./src/proxy.ts only"), so the session gate lives
// here rather than in a second file.
//
// It runs on every request that the matcher below does not exclude, refreshes
// the Supabase session cookie, and gates access. The gate is deny-by-default:
// anything not explicitly listed as public requires a session. The previous
// version allow-listed a handful of path prefixes, which meant /proposals was
// reachable while signed out.
// ---------------------------------------------------------------------------

/**
 * Paths reachable without an app session.
 *
 * /api/webhooks/* and /api/cron/* are deliberately public: those handlers are
 * invoked by machines, not people — Twilio with an HMAC signature, Vercel Cron
 * with a bearer CRON_SECRET — and carry no session cookie. Gating them here
 * would 401 every inbound webhook and every scheduled run. Each handler
 * authenticates its own caller before doing anything.
 *
 * /setup-password is where an invitation link lands. The invitee's session
 * arrives in the URL fragment, which the browser never sends to the server, so
 * this middleware cannot see it — gating the route would bounce every invitee
 * to /login before the page could read it. Public here means the page renders,
 * nothing more: it reads no data, and the password it sets goes through
 * Supabase Auth against whatever session the page manages to establish. A
 * visitor arriving with no valid link gets an explanation, never the form.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/setup-password",
  "/api/auth",
  "/api/webhooks",
  "/api/cron",
];

/** Routes only an admin may call. Route handlers re-check with requireAdmin(). */
const ADMIN_ONLY_PREFIXES = ["/api/agents"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes the session cookie as a side effect — must run before any
  // early return that is meant to carry a refreshed session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isPublicPath(pathname)) {
    // Signed-in users have no business on the login page. /setup-password is
    // deliberately not included: an invitee reaches it *with* a session — the
    // page establishes one from the link before showing the form — so bouncing
    // a signed-in visitor away from it would break the only path to it.
    if (user && pathname.startsWith("/login")) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Deny by default: everything below this line requires a session.
  if (!user) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Coarse RBAC net in front of admin-only APIs. This is defence in depth:
  // the route handlers call requireAdmin() themselves, and the RLS policies
  // are the actual enforcement boundary.
  if (ADMIN_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    // agent_profiles is keyed to auth.users by user_id. The previous version
    // matched on `id`, which is the table's own primary key — it never found a
    // row, and the check below then fell through and allowed the request.
    const { data: profile } = await supabase
      .from("agent_profiles")
      .select("role, is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fail closed: no profile, an inactive profile, or a non-admin role is
    // refused. A missing profile is not a "fresh setup" to wave through.
    const isAdmin = profile?.role === "admin" && profile?.is_active === true;

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: admin access required" },
        { status: 403 }
      );
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
