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
 * Routes authenticated by something other than a session cookie. The Twilio
 * webhook verifies an HMAC signature and must stay reachable without a login,
 * which is also why it is the one place the service-role client is allowed.
 */
const PUBLIC_ROUTES = ["webhooks/twilio/sms/route.ts"];

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

  it("the service-role client is used only by webhooks", () => {
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

    // The definition site plus the Twilio webhook, and nothing else.
    expect(users.sort()).toEqual([
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
