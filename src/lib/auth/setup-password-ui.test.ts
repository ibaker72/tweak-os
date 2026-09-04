import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * The invitation acceptance page, the login page it must not disturb, and the
 * middleware that decides who can reach either.
 *
 * There is no DOM renderer in this project, so these read the source. The
 * behaviour of accepting an invitation is covered properly in
 * invite-session.test.ts against a fake auth client; what is left for here is
 * the wiring — which states exist, what the page hands to that logic, and what
 * it never sends.
 */

const SRC = path.resolve(__dirname, "../..");
const REPO = path.resolve(SRC, "..");

const page = readFileSync(path.join(SRC, "app/setup-password/page.tsx"), "utf8");
const login = readFileSync(path.join(SRC, "app/login/page.tsx"), "utf8");
const proxy = readFileSync(path.join(SRC, "proxy.ts"), "utf8");

describe("the acceptance page", () => {
  it("runs in the browser, which is the only place a URL fragment exists", () => {
    expect(page.startsWith('"use client"')).toBe(true);
    expect(page).toContain("window.location");
  });

  it("has a state for every way an invitation can go", () => {
    expect(page).toContain('type Stage = "checking" | "ready" | "invalid" | "done"');
    expect(page).toContain("Checking your invitation...");
    expect(page).toContain("Finish account setup");
    expect(page).toContain("Invitation problem");
    expect(page).toContain("Taking you to your dashboard...");
    // A dead end always offers a way out.
    expect(page).toContain('href="/login"');
  });

  it("shows the form only once a session is established", () => {
    expect(page).toContain('{stage === "ready" && (');
    const form = page.slice(page.indexOf('{stage === "ready" && ('));
    expect(form).toContain("<form onSubmit={handleSubmit}");
    // And the two fields it needs, as password inputs.
    expect(form).toContain('id="new-password"');
    expect(form).toContain('id="confirm-password"');
    expect((form.match(/type="password"/g) ?? []).length).toBe(2);
    expect((form.match(/autoComplete="new-password"/g) ?? []).length).toBe(2);
  });

  it("delegates the decisions to the audited logic rather than re-deriving them", () => {
    expect(page).toContain("parseInviteParams(hash, search)");
    expect(page).toContain("establishInviteSession(browserAuth(), params)");
    expect(page).toContain("applyNewPassword(browserAuth(), password, confirmation)");
    expect(page).toContain("PASSWORD_MIN_LENGTH");
  });

  it("captures the fragment before anything can clear it, then removes it", () => {
    const effect = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("async function handleSubmit"));
    // Read first...
    expect(effect.indexOf("const { hash, search, pathname } = window.location;")).toBeLessThan(
      effect.indexOf("establishInviteSession")
    );
    // ...then taken out of the address bar.
    expect(effect).toContain("window.history.replaceState(window.history.state, \"\", pathname)");
  });

  /**
   * Strict Mode runs effects twice in development. A second pass would spend a
   * code or token_hash the first pass consumed, turning a good invitation into
   * an expired one.
   */
  it("consumes the link exactly once", () => {
    expect(page).toContain("const started = useRef(false)");
    expect(page).toContain("if (started.current) return;");
    expect(page).toContain("started.current = true;");
  });

  it("lands on the fixed destination, never one taken from the URL", () => {
    expect(page).toContain("router.replace(POST_SETUP_REDIRECT)");
    // No open redirect: no `next`, no `redirect_to`, no `returnTo`.
    for (const steerable of ["next", "redirect_to", "redirectTo", "returnTo", "continue"]) {
      expect(page).not.toMatch(new RegExp(`searchParams.*${steerable}`));
    }
    expect(page).not.toContain("window.location.href =");
  });

  it("names no account and leaks no secret", () => {
    expect(page).not.toMatch(/user_id/);
    expect(page).not.toMatch(/\buserId\b/);
    // One console call, and it logs the error object only.
    const logs = page.match(/console\.\w+\([^)]*\)/g) ?? [];
    expect(logs).toEqual(['console.error("Set password error:", err)']);
    for (const log of logs) {
      expect(log).not.toMatch(/password[,)]|confirmation|access_token|token/);
    }
  });

  it("is a browser module with no server credentials in it", () => {
    for (const forbidden of [
      "process.env.SUPABASE_SERVICE_ROLE_KEY",
      "createServiceClient",
      "supabase/service",
      "supabase/admin-auth",
      "auth.admin",
    ]) {
      expect(page, `setup-password page must not reference ${forbidden}`).not.toContain(
        forbidden
      );
    }
    // The anon browser client, same as every other client page.
    expect(page).toContain('import { createClient } from "@/lib/supabase/client"');
  });
});

describe("the login page is untouched", () => {
  it("still signs an existing user in with email and password", () => {
    expect(login).toContain("supabase.auth.signInWithPassword({");
    expect(login).toContain('router.push("/dashboard")');
    expect(login).toContain("Sign in to Tweak&amp;Build OS");
    expect(login).toContain('{loading ? "Signing in..." : "Sign In"}');
  });

  it("does not try to handle invitations", () => {
    for (const absent of [
      "setSession",
      "updateUser",
      "exchangeCodeForSession",
      "verifyOtp",
      "window.location.hash",
    ]) {
      expect(login, `login page must not contain ${absent}`).not.toContain(absent);
    }
  });
});

describe("the middleware", () => {
  it("opens exactly the entry points that need to work without a session", () => {
    const list = proxy.slice(
      proxy.indexOf("const PUBLIC_PREFIXES = ["),
      proxy.indexOf("];", proxy.indexOf("const PUBLIC_PREFIXES = ["))
    );
    const prefixes = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    // Deny-by-default is the rule; this is the whole list of exceptions.
    expect(prefixes.sort()).toEqual([
      "/api/auth",
      "/api/cron",
      "/api/webhooks",
      "/login",
      "/setup-password",
    ]);
  });

  it("still bounces a signed-in visitor off /login only", () => {
    expect(proxy).toContain('if (user && pathname.startsWith("/login"))');
    // An invitee reaches /setup-password *with* a session; bouncing them would
    // break the only path to it.
    expect(proxy).not.toContain('pathname.startsWith("/setup-password")');
  });

  it("keeps /api/agents admin-only and the deny-by-default gate intact", () => {
    expect(proxy).toContain('const ADMIN_ONLY_PREFIXES = ["/api/agents"]');
    expect(proxy).toContain("if (!user) {");
    expect(proxy).toContain('NextResponse.json({ error: "Unauthorized" }, { status: 401 })');
    expect(proxy).toContain('error: "Forbidden: admin access required"');
  });
});

/**
 * The audit this design rests on, pinned so an SDK upgrade cannot silently
 * invalidate it.
 *
 * If either assertion below fails, the invitation flow needs re-auditing
 * before the upgrade ships: the acceptance page reads the URL fragment by hand
 * precisely because the SDK will not.
 */
describe("the Supabase SDK behaviour this depends on", () => {
  const ssr = path.join(REPO, "node_modules/@supabase/ssr/dist/main/createBrowserClient.js");
  const authJs = path.join(REPO, "node_modules/@supabase/auth-js/dist/module/GoTrueClient.js");
  const installed = existsSync(ssr) && existsSync(authJs);
  const when = installed ? it : it.skip;

  when("createBrowserClient still forces the PKCE flow, overriding caller options", () => {
    const src = readFileSync(ssr, "utf8");
    const auth = src.slice(src.indexOf("auth: {"), src.indexOf("if (shouldUseSingleton)"));
    expect(auth).toContain('flowType: "pkce"');
    // Set after the caller's options are spread, so it cannot be overridden.
    expect(auth.indexOf("...options?.auth")).toBeLessThan(auth.indexOf('flowType: "pkce"'));
  });

  when("auth-js still refuses an implicit-grant URL under a PKCE client", () => {
    const src = readFileSync(authJs, "utf8");
    const check = src.slice(
      src.indexOf("switch (callbackUrlType)"),
      src.indexOf("case 'pkce':", src.indexOf("switch (callbackUrlType)"))
    );
    expect(check).toContain("case 'implicit':");
    expect(check).toContain("this.flowType === 'pkce'");
    expect(check).toContain("Not a valid PKCE flow url.");
  });
});
