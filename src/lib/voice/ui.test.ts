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
const settings = readFileSync(SRC + "/app/(platform)/settings/page.tsx", "utf8");

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

  it("masks the agent's own number rather than printing it in full", () => {
    // It is the agent's personal phone, displayed on a page of prospect data.
    // Recognisable is the requirement; readable is not.
    expect(panel).toContain("maskPhoneNumber(agentVoicePhone)");
    expect(panel).not.toContain("{agentVoicePhone ?? (");
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
    // Read through the shared accessor rather than an inline select, so this
    // page and the Settings field cannot drift onto different columns.
    expect(leadPage).toContain("getCallbackPhone(supabase, { userId: user.id })");
    expect(leadPage).not.toContain('.select("voice_phone")');
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

describe("the Settings callback-number field", () => {
  it("keeps the saved value and the input box as separate state", () => {
    // One box serving as both is what let a grey placeholder read as a saved
    // number, and an empty box read as "erase it".
    expect(settings).toContain("const [savedVoicePhone, setSavedVoicePhone]");
    expect(settings).toContain("const [voicePhoneDraft, setVoicePhoneDraft]");
  });

  it("shows what is actually stored, and says so when nothing is", () => {
    expect(settings).toContain("Saved number");
    expect(settings).toContain("formatPhoneNumber(savedVoicePhone)");
    expect(settings).toContain("None saved");
    expect(settings).toContain("Twilio calling off");
  });

  it("has no placeholder that could be mistaken for a saved number", () => {
    // The original placeholder was a complete, real-looking number — the exact
    // one the user believed they had entered.
    const placeholders = [...settings.matchAll(/placeholder=\{?"([^"]*)"/g)].map(
      (m) => m[1]
    );
    for (const value of placeholders) {
      expect(
        /\+?\d[\d\s().-]{6,}/.test(value),
        `placeholder "${value}" looks like a phone number`
      ).toBe(false);
    }
  });

  it("cannot erase the number from an empty box", () => {
    // Save is unavailable with nothing typed, and the request it sends never
    // carries the clear flag.
    expect(settings).toContain("voicePhoneDraft.trim().length === 0");
    expect(settings).toContain('submitVoicePhone("save")');
  });

  it("erases only through an explicit, confirmed Remove", () => {
    expect(settings).toContain("Remove your callback number?");
    expect(settings).toContain('onConfirm={() => submitVoicePhone("clear")}');
    expect(settings).toContain("setConfirmClearVoicePhone(true)");
  });

  it("sends the clear flag alongside the number, never a bare blank", () => {
    expect(settings).toContain("voice_phone: clearing ? null : trimmed");
    expect(settings).toContain("clear: clearing");
  });

  it("displays the value the server read back, not the one that was typed", () => {
    expect(settings).toContain("const stored: string | null = data.voice_phone ?? null");
    expect(settings).toContain("setSavedVoicePhone(stored)");
  });

  it("distinguishes a save from an erase from a failure", () => {
    expect(settings).toContain('tone: "ok"');
    expect(settings).toContain('tone: "warn"');
    expect(settings).toContain('tone: "error"');
    expect(settings).toContain("Callback number removed");
  });

  it("refreshes the router so the lead page stops showing the old value", () => {
    // The lead page renders the number on the server; without this the client
    // router cache can serve the previous render for up to its stale window.
    const handler = settings.slice(
      settings.indexOf("async function submitVoicePhone"),
      settings.indexOf("async function handleCreateAgent")
    );
    expect(handler).toContain("router.refresh()");
  });

  it("writes through the API route rather than straight to the table", () => {
    // A client-side update would need an agent UPDATE policy on
    // agent_profiles, which is exactly the policy that must not exist.
    expect(settings).toContain('fetch("/api/my/voice-phone"');
    expect(settings).not.toContain('.from("agent_profiles")');
  });
});
