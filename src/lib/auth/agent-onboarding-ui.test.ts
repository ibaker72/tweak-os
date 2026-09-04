import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The Team Management card in Settings, and the line between what runs in the
 * browser and what does not.
 *
 * There is no DOM renderer in this project, so these read the source. That is
 * enough for the two properties that matter here: the submit handler must act
 * on the response it gets rather than only on the happy shape of it, and no
 * service-role credential may reach a client bundle.
 */

const SRC = path.resolve(__dirname, "../..");

/** These assertions are about code, and a comment may legitimately quote it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const page = readFileSync(path.join(SRC, "app/(platform)/settings/page.tsx"), "utf8");

/** The invite handler, sliced out so an assertion cannot pass on other code. */
const createAgent = page.slice(
  page.indexOf("async function handleCreateAgent()"),
  page.indexOf("async function handleToggleAgent(")
);
const toggleAgent = page.slice(
  page.indexOf("async function handleToggleAgent("),
  page.indexOf("async function handleSaveTemplate(")
);

describe("the invite form", () => {
  it("asks for a name and an email and nothing else", () => {
    expect(page).toContain('aria-label="New agent name"');
    expect(page).toContain('aria-label="New agent email"');
    expect(createAgent).toContain("JSON.stringify({ display_name: name, email })");
    // The id the browser cannot know, and the role that is the server's
    // call: neither appears as a key in anything this sends.
    expect(createAgent).not.toMatch(/user_id\s*:/);
    expect(createAgent).not.toMatch(/role\s*:\s*["']/);
  });

  it("says what the button does", () => {
    expect(page).toContain("Invite Agent");
    expect(page).toContain('{creatingAgent ? "Inviting..." : "Invite Agent"}');
  });

  it("disables the button while a request is in flight", () => {
    expect(page).toContain(
      "disabled={creatingAgent || !newAgentName.trim() || !newAgentEmail.trim()}"
    );
    expect(createAgent).toContain("setCreatingAgent(true)");
    expect(createAgent).toContain("setCreatingAgent(false)");
    expect(createAgent).toContain("} finally {");
  });

  it("validates both fields before spending a round trip", () => {
    expect(createAgent).toContain("if (!name)");
    expect(createAgent).toContain("EMAIL_PATTERN.test(email)");
    // Both rejections say something; neither returns silently.
    const earlyReturns = createAgent.slice(0, createAgent.indexOf("setCreatingAgent(true)"));
    expect((earlyReturns.match(/setAgentMessage\(/g) ?? []).length).toBe(2);
  });

  it("normalises the email the same way the server does", () => {
    expect(createAgent).toContain("newAgentEmail.trim().toLowerCase()");
    expect(createAgent).toContain("newAgentName.trim()");
  });
});

describe("what the form does with the response", () => {
  /**
   * The bug this card had: the handler read `data.agent` and ignored
   * everything else, so a 400 was indistinguishable from a working button.
   */
  it("checks the status before believing the body", () => {
    expect(createAgent).toContain("if (!res.ok || !data.agent)");
    expect(createAgent).toContain("data.error ??");
  });

  it("renders the server's own error text", () => {
    expect(createAgent).toMatch(
      /text:\s*data\.error \?\? "Could not send the invitation\. Try again\."/
    );
  });

  it("has a message for a request that never arrives", () => {
    expect(createAgent).toContain("catch (err)");
    expect(createAgent).toMatch(/Network error while sending the invitation/);
  });

  it("distinguishes an invitation sent from an existing login linked", () => {
    expect(createAgent).toContain('data.outcome === "linked"');
    expect(createAgent).toMatch(/already had a login/);
    expect(createAgent).toMatch(/Invitation sent to/);
  });

  it("adds the new agent to the list and clears both inputs on success", () => {
    expect(createAgent).toContain("setAgents(");
    expect(createAgent).toContain('setNewAgentName("")');
    expect(createAgent).toContain('setNewAgentEmail("")');

    // Cleared only after the success check, never on the error path.
    const failure = createAgent.indexOf("if (!res.ok || !data.agent)");
    expect(createAgent.indexOf('setNewAgentName("")')).toBeGreaterThan(failure);
  });

  it("keeps the list in the order the API returns it", () => {
    expect(createAgent).toContain("a.display_name.localeCompare(b.display_name)");
  });

  it("shows the message in the page, never in an alert box", () => {
    expect(page).toContain("{agentMessage.text}");
    expect(page).toContain('role="status"');
    expect(page).not.toContain("alert(");
    expect(page).not.toContain("window.confirm");
  });
});

describe("activate / deactivate", () => {
  /**
   * The server refuses an admin deactivating themselves. The optimistic
   * version flipped the badge anyway, which made the protection look like it
   * had failed to protect anything.
   */
  it("reflects what the server stored rather than what was asked", () => {
    expect(toggleAgent).toContain("if (!res.ok || !data.agent)");
    expect(toggleAgent).toContain("data.error ??");
    expect(toggleAgent).toContain("...updated");
    // The old optimistic write: the flag flipped in local state regardless of
    // what came back. Sending `is_active: !isActive` in the request body is
    // still right — believing it without being told is not.
    expect(toggleAgent).not.toMatch(/\.\.\.a,\s*is_active:/);
  });
});

// ---------------------------------------------------------------------------

describe("service-role credentials stay on the server", () => {
  const clientFiles: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        const src = readFileSync(full, "utf8");
        // Anything Next will ship to the browser: a "use client" module, or
        // anything under components/, which only client trees import.
        if (src.startsWith('"use client"') || full.includes(`${path.sep}components${path.sep}`)) {
          clientFiles.push(full);
        }
      }
    }
  };
  walk(SRC);

  it("finds the client modules to check", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it("no browser module names the service-role key or the admin clients", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const src = readFileSync(file, "utf8");
      // The bare name SUPABASE_SERVICE_ROLE_KEY is allowed: the Settings
      // page lists it as documentation in the API Keys card. Reading its
      // value, or importing anything that does, is what is forbidden.
      for (const forbidden of [
        "process.env.SUPABASE_SERVICE_ROLE_KEY",
        "createServiceClient",
        "supabase/service",
        "supabase/admin-auth",
        "getAdminAuth",
        "auth.admin",
      ]) {
        if (src.includes(forbidden)) {
          offenders.push(`${path.relative(SRC, file)} -> ${forbidden}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Auth Admin API is reachable only through the server-only wrapper", () => {
    const wrapper = stripComments(
      readFileSync(path.join(SRC, "lib/supabase/admin-auth.ts"), "utf8")
    );
    // It hands out auth.admin and nothing that can read or write a table.
    expect(wrapper).toContain("createServiceClient().auth.admin");
    expect(wrapper).not.toContain(".from(");

    const onboarding = readFileSync(path.join(SRC, "lib/auth/agent-onboarding.ts"), "utf8");
    // The onboarding logic takes the admin API as an argument; it cannot reach
    // for a service-role client of its own.
    expect(onboarding).not.toContain("createServiceClient");
    expect(onboarding).not.toContain("SERVICE_ROLE");

    const route = readFileSync(path.join(SRC, "app/api/agents/route.ts"), "utf8");
    // The profile write goes through the caller's RLS-bound client.
    expect(route).toContain("guard.supabase");
    expect(route).not.toContain("createServiceClient");
  });

  it("the invite redirect points at the acceptance route, which exists", () => {
    const onboarding = readFileSync(path.join(SRC, "lib/auth/agent-onboarding.ts"), "utf8");
    expect(onboarding).toContain('INVITE_REDIRECT_PATH = "/setup-password"');

    // It is a real page, and the middleware lets a signed-out invitee reach
    // it — their session is in a URL fragment the server never sees.
    expect(() => statSync(path.join(SRC, "app/setup-password/page.tsx"))).not.toThrow();
    expect(readFileSync(path.resolve(SRC, "proxy.ts"), "utf8")).toContain(
      '"/setup-password"'
    );
  });
});
