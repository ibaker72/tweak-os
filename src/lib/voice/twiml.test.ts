import { describe, it, expect } from "vitest";
import { buildBridgeTwiml, buildEmptyTwiml, buildRejectTwiml, escapeXml } from "./twiml";

describe("buildBridgeTwiml", () => {
  const twiml = buildBridgeTwiml({
    prospectPhone: "+19735551234",
    callerId: "+18622984988",
  });

  it("is a well-formed TwiML document", () => {
    expect(twiml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>')).toBe(true);
    expect(twiml.endsWith("</Response>")).toBe(true);
  });

  it("dials the prospect", () => {
    expect(twiml).toContain("<Number>+19735551234</Number>");
  });

  it("sets callerId to the Twilio number, never the agent's phone", () => {
    expect(twiml).toContain('callerId="+18622984988"');
    // The agent's own number appears nowhere in what the prospect's carrier sees.
    expect(twiml).not.toContain("+15550001111");
  });

  it("uses answerOnBridge so the call is not billed as answered before pickup", () => {
    expect(twiml).toContain('answerOnBridge="true"');
  });

  it("never asks Twilio to record", () => {
    expect(twiml.toLowerCase()).not.toContain("record");
  });

  it("escapes anything interpolated", () => {
    const hostile = buildBridgeTwiml({
      prospectPhone: '+1"/><Say>pwned</Say><Dial callerId="+1666',
      callerId: "+18622984988",
    });
    expect(hostile).not.toContain("<Say>pwned</Say>");
    expect(hostile).toContain("&quot;");
  });

  it("honours a custom ring timeout", () => {
    expect(
      buildBridgeTwiml({ prospectPhone: "+1973", callerId: "+1862", timeoutSeconds: 45 })
    ).toContain('timeout="45"');
  });
});

describe("buildRejectTwiml", () => {
  it("hangs up without dialing anything", () => {
    const twiml = buildRejectTwiml();
    expect(twiml).toContain("<Hangup/>");
    expect(twiml).not.toContain("<Dial");
    expect(twiml).not.toContain("<Number>");
  });

  it("says nothing about why", () => {
    // Whoever answered is on a phone line; the reason belongs in the log.
    const twiml = buildRejectTwiml();
    expect(twiml).not.toMatch(/token|signature|database|lead/i);
  });
});

describe("buildEmptyTwiml", () => {
  it("acknowledges and does nothing", () => {
    expect(buildEmptyTwiml()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    );
  });
});

describe("escapeXml", () => {
  it("escapes all five XML entities", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("escapes ampersands before the rest, so entities are not double-built", () => {
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});
