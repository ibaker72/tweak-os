import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Structural guard rails. RLS is the real enforcement boundary, but an
 * unguarded route still leaks a 200 with an empty body to strangers and makes
 * failures harder to read — and a service-role client in a user-facing route
 * bypasses RLS entirely, which is the one mistake that would undo all of
 * Phase 1.
 *
 * These read the source rather than execute it, so a new route added later is
 * caught the moment it lands.
 */

const API_DIR = path.resolve(__dirname, "../../app/api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const files = routeFiles(API_DIR);

/**
 * Routes authenticated by something other than a session cookie, because their
 * caller is a machine with no session:
 *
 *   the Twilio webhook verifies an HMAC signature;
 *   the nightly cron verifies a bearer CRON_SECRET.
 *
 * These are also the only two places the service-role client is allowed —
 * there is no user to act as, so there is no RLS-bound client to use.
 */
const PUBLIC_ROUTES = [
  "webhooks/twilio/sms/route.ts",
  "cron/commissions/accrue/route.ts",
];

const HANDLER_RE = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/g;

function relative(file: string) {
  return path.relative(API_DIR, file).split(path.sep).join("/");
}

describe("API route guard coverage", () => {
  it("finds route files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every handler in every non-public route calls a guard", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(file);
      if (PUBLIC_ROUTES.includes(rel)) continue;

      const src = readFileSync(file, "utf8");
      const handlers = [...src.matchAll(HANDLER_RE)].map((m) => m[1]);
      const guards = [...src.matchAll(/const guard = await require(User|Admin)\(\)/g)];

      if (handlers.length !== guards.length) {
        offenders.push(
          `${rel}: ${handlers.length} handler(s) [${handlers.join(", ")}] but ${guards.length} guard call(s)`
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no user-facing route imports the service-role client", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(file);
      if (PUBLIC_ROUTES.includes(rel)) continue;

      const src = readFileSync(file, "utf8");
      if (src.includes("createServiceClient") || src.includes("supabase/service")) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("every public route authenticates its caller some other way", () => {
    // Exempt from the session gate is not exempt from authentication. Each of
    // these must verify a signature or a shared secret before doing anything.
    for (const rel of PUBLIC_ROUTES) {
      const src = readFileSync(path.join(API_DIR, rel), "utf8");
      const authenticates =
        src.includes("verifyTwilioSignature") ||
        src.includes("timingSafeEqual") ||
        src.includes("CRON_SECRET");
      expect(authenticates, `${rel} has no caller authentication`).toBe(true);
    }
  });

  it("the service-role client is used only by machine-authenticated routes", () => {
    const srcDir = path.resolve(__dirname, "../..");
    const users: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          // Test files talk *about* the service client; only real call sites
          // count.
          const src = readFileSync(full, "utf8");
          if (src.includes("createServiceClient(")) {
            users.push(path.relative(srcDir, full).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(srcDir);

    // The definition site plus the two machine-authenticated routes.
    expect(users.sort()).toEqual([
      "app/api/cron/commissions/accrue/route.ts",
      "app/api/webhooks/twilio/sms/route.ts",
      "lib/supabase/service.ts",
    ]);
  });

  it("no route still references a table removed in Phase 0", () => {
    const dead = ["growth_drafts", "growth_opportunities", "growth_briefs", "lead_audits"];
    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const table of dead) {
        if (src.includes(`"${table}"`)) offenders.push(`${relative(file)} -> ${table}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
