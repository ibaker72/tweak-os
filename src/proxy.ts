import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

if (pathname.startsWith("/api/v1/openclaw/")) {
  return NextResponse.next();
}
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth");

  // Redirect unauthenticated users to login for all protected routes
  if (!user && !isPublicRoute) {
    // Protect all app routes (dashboard, leads, growth, settings, etc.)
    const isAppRoute =
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/leads") ||
      pathname.startsWith("/growth") ||
      pathname.startsWith("/settings") ||
      pathname.startsWith("/smart-lists");

    // Protect all API routes (except /api/auth/*)
    const isProtectedApi =
      pathname.startsWith("/api/") && !pathname.startsWith("/api/auth");

    if (isAppRoute || isProtectedApi) {
      if (isProtectedApi) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  // Redirect authenticated users away from login
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // RBAC: Admin-only API routes
  const adminOnlyRoutes = [
    "/api/agents",
  ];

  if (user && adminOnlyRoutes.some((r) => pathname.startsWith(r))) {
    // Check if user has admin role via agent_profiles
    const { data: profile } = await supabase
      .from("agent_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    // Allow if no agent_profiles table exists yet (fresh setup) or if admin
    if (profile && profile.role !== "admin") {
      if (request.method !== "GET") {
        return NextResponse.json(
          { error: "Forbidden: admin access required" },
          { status: 403 }
        );
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
