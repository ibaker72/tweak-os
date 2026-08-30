import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions about the two surfaces that can place a real phone
 * call. There is no DOM renderer in this project, so these read the source —
 * which is enough for the properties that matter here, all of which are about
 * what the components send and what they refuse to send.
 */

const SRC = path.resolve(__dirname, "../..");
const panel = readFileSync(
  path.join(SRC, "components/dashboard/voice-call-panel.tsx"),
  "utf8"
);
const queue = readFileSync(
  path.join(SRC, "app/(platform)/my/queue/QueueClient.tsx"),
  "utf8"
);
const leadPage = readFileSync(
  path.join(SRC, "app/(platform)/leads/[id]/page.tsx"),
  "utf8"
);

describe("the lead page voice panel", () => {
  it("posts lead_id and nothing else", () => {
    const body = panel.match(/body: JSON\.stringify\(\{ lead_id: lead\.id \}\)/);
    expect(body).not.toBeNull();
    for (const forbidden of [
      "prospect_phone:",
      "agent_phone:",
      "agent_id:",
      "from_number:",
      "caller_id:",
    ]) {
      expect(panel, `${forbidden} must not be sent from the client`).not.toContain(
        forbidden
      );
    }
  });

  it("shows the call button only when the lead has a phone", () => {
    expect(panel).toContain("{hasPhone && (");
    expect(panel).toContain("Call via Twilio");
  });

  it("disables the button without a callback number or on do-not-contact", () => {
    expect(panel).toContain("disabled={calling || !hasCallbackNumber || doNotContact}");
  });

  it("carries the exact copy for each refusal", () => {
    expect(panel).toContain("Calling your phone… Answer to connect to the prospect.");
    expect(panel).toContain(
      "Add your callback phone number before using Twilio calling."
    );
    expect(panel).toContain("This lead has no phone number");
    expect(panel).toContain("Twilio Voice disabled");
  });

  it("has a loading state so the button cannot be double-pressed", () => {
    expect(panel).toContain('{calling ? "Placing call…" : "Call via Twilio"}');
    expect(panel).toContain("setCalling(true)");
  });

  it("confirms before dialing", () => {
    expect(panel).toContain("ConfirmDialog");
    expect(panel).toContain("setShowConfirm(true)");
    // The button opens the dialog; only the dialog's onConfirm places the call.
    expect(panel).toContain("onConfirm={placeCall}");
  });

  it("keeps Log Call available beside it, on the existing endpoint", () => {
    expect(panel).toContain("Log Call");
    expect(panel).toContain('"/api/my/actions"');
    expect(panel).toContain('action: "log_call"');
  });

  it("never writes a lifecycle status from a call attempt", () => {
    expect(panel).not.toContain("lifecycle_status");
    expect(panel).not.toContain("contacted_at");
    expect(panel).not.toContain('"/api/leads"');
  });

  it("says calls are not recorded", () => {
    expect(panel).toContain("not recorded");
  });

  it("surfaces the Twilio failure detail rather than swallowing it", () => {
    expect(panel).toContain("data.error_message");
    expect(panel).toContain("feedback.detail");
  });
});

describe("the lead page wires the panel with server-resolved state", () => {
  it("reads the flag on the server, never from a NEXT_PUBLIC variable", () => {
    expect(leadPage).toContain("voiceEnabled={isVoiceEnabled()}");
    expect(leadPage).not.toContain("NEXT_PUBLIC_TWILIO");
  });

  it("passes the caller's own callback number", () => {
    expect(leadPage).toContain("agentVoicePhone={agentVoicePhone}");
    expect(leadPage).toContain('.eq("user_id", user.id)');
  });

  it("loads call history through the RLS-bound client", () => {
    expect(leadPage).toContain("getVoiceCallsForLead(supabase, id");
    expect(leadPage).not.toContain("createServiceClient");
  });
});

describe("My Queue", () => {
  it("keeps `c` as log-a-call and gives it no calling shortcut", () => {
    // The keyboard handler must not be able to ring a phone.
    const keyHandler = queue.slice(
      queue.indexOf("function onKeyDown"),
      queue.indexOf("document.addEventListener")
    );
    expect(keyHandler).toContain('setComposer({ kind: "log_call"');
    expect(keyHandler).not.toContain("placeCall");
    expect(keyHandler).not.toContain("/api/voice/call");
  });

  it("places a call only from the confirm dialog", () => {
    expect(queue).toContain("setCallTarget(lead)");
    expect(queue).toContain("onConfirm={placeCall}");
    // The row button opens the dialog; it does not call.
    expect(queue).not.toMatch(/onClick=\{\(\) => placeCall\(\)\}/);
  });

  it("labels the two actions distinguishably", () => {
    expect(queue).toContain("Call via Twilio — rings your phone, then bridges");
    expect(queue).toContain('title="Log call (c)"');
  });

  it("offers the call button only on a lead with a phone", () => {
    expect(queue).toContain("{lead.phone && (");
  });

  it("posts lead_id only", () => {
    expect(queue).toContain("body: JSON.stringify({ lead_id: lead.id })");
    expect(queue).not.toContain("prospect_phone");
  });

  it("does not change the lead's stage on a call attempt", () => {
    const placeCall = queue.slice(
      queue.indexOf("const placeCall = useCallback"),
      queue.indexOf("// Keyboard handling")
    );
    expect(placeCall).not.toContain("lifecycle_status");
    expect(placeCall).not.toContain("contacted_at");
    expect(placeCall).not.toContain("setLeads");
  });
});

describe("no Twilio configuration reaches the browser", () => {
  it("has no NEXT_PUBLIC_ Twilio variable anywhere in src", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          // Test files talk *about* the forbidden names; only real code counts.
          const src = readFileSync(full, "utf8");
          if (/NEXT_PUBLIC_TWILIO|NEXT_PUBLIC_[A-Z_]*VOICE/.test(src)) {
            offenders.push(path.relative(SRC, full).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it("keeps the voice config out of client components", () => {
    // A "use client" file importing the config would ship the module to the
    // browser, where every value would silently be undefined.
    expect(panel.startsWith('"use client"')).toBe(true);
    expect(panel).not.toContain("@/lib/voice/config");
    expect(panel).not.toContain("@/lib/voice/twilio");
    expect(queue).not.toContain("@/lib/voice/config");
  });
});
