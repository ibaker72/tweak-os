import { describe, it, expect } from "vitest";
import {
  formatPhoneNumber,
  isStoredE164,
  isValidPhoneNumber,
  maskPhoneNumber,
  normalizeCallbackPhone,
  normalizePhoneNumber,
} from "./phone";
import { normalizePhoneNumber as fromSmsConfig } from "@/lib/sms/config";

describe("normalizePhoneNumber", () => {
  it("normalises the shapes a US number actually gets typed in", () => {
    for (const input of [
      "(862) 298-4988",
      "862-298-4988",
      "862.298.4988",
      "8622984988",
      "  862 298 4988  ",
      "1-862-298-4988",
      "18622984988",
      "+1 (862) 298-4988",
      "+18622984988",
    ]) {
      expect(normalizePhoneNumber(input), input).toBe("+18622984988");
    }
  });

  it("keeps a non-US number only in full E.164 form", () => {
    expect(normalizePhoneNumber("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhoneNumber("+442079460958")).toBe("+442079460958");
    // Nine digits with no country code is not a number we can guess at.
    expect(normalizePhoneNumber("207946095")).toBeNull();
  });

  it("rejects what it cannot dial", () => {
    for (const input of [
      "",
      "   ",
      "call me maybe",
      "555",
      "+1",
      "+123",
      "86229849", // 8 digits, no country code
      null,
      undefined,
    ]) {
      expect(normalizePhoneNumber(input), String(input)).toBeNull();
    }
  });

  it("is the same implementation the SMS module uses", () => {
    // Two copies of these rules is how Settings comes to accept a number the
    // dialer refuses. There is one function and both modules import it.
    expect(fromSmsConfig).toBe(normalizePhoneNumber);
  });
});

describe("isValidPhoneNumber", () => {
  it("agrees with normalizePhoneNumber", () => {
    expect(isValidPhoneNumber("(862) 298-4988")).toBe(true);
    expect(isValidPhoneNumber("nope")).toBe(false);
    expect(isValidPhoneNumber("")).toBe(false);
  });
});

describe("isStoredE164", () => {
  it("matches the agent_profiles_voice_phone_ck constraint", () => {
    expect(isStoredE164("+18622984988")).toBe(true);
    expect(isStoredE164("+442079460958")).toBe(true);
    // Leading zero after the +, which the column's CHECK refuses.
    expect(isStoredE164("+0123456789")).toBe(false);
    expect(isStoredE164("8622984988")).toBe(false);
    expect(isStoredE164(null)).toBe(false);
  });
});

describe("normalizeCallbackPhone", () => {
  it("accepts what the callback column will store", () => {
    expect(normalizeCallbackPhone("(862) 298-4988")).toBe("+18622984988");
    expect(normalizeCallbackPhone("8622984988")).toBe("+18622984988");
    expect(normalizeCallbackPhone("+18622984988")).toBe("+18622984988");
  });

  it("refuses a value the column's CHECK would reject", () => {
    // normalizePhoneNumber is happy with this; the constraint is not, so the
    // callback path has to catch it before the write.
    expect(normalizePhoneNumber("+0123456789")).toBe("+0123456789");
    expect(normalizeCallbackPhone("+0123456789")).toBeNull();
  });

  it("treats blank as no number rather than as an error value", () => {
    expect(normalizeCallbackPhone("")).toBeNull();
    expect(normalizeCallbackPhone("   ")).toBeNull();
    expect(normalizeCallbackPhone(null)).toBeNull();
  });
});

describe("formatPhoneNumber", () => {
  it("renders a NANP number the way it is read aloud", () => {
    expect(formatPhoneNumber("+18622984988")).toBe("+1 (862) 298-4988");
    expect(formatPhoneNumber("8622984988")).toBe("+1 (862) 298-4988");
  });

  it("leaves an international number alone rather than guessing its grouping", () => {
    expect(formatPhoneNumber("+442079460958")).toBe("+442079460958");
  });

  it("renders nothing for nothing", () => {
    expect(formatPhoneNumber(null)).toBe("");
    expect(formatPhoneNumber("")).toBe("");
  });
});

describe("maskPhoneNumber", () => {
  it("keeps the area code and the last four", () => {
    expect(maskPhoneNumber("+18622984988")).toBe("+1 (862) •••-4988");
  });

  it("hides everything but the last four of an international number", () => {
    const masked = maskPhoneNumber("+442079460958");
    expect(masked.endsWith("0958")).toBe(true);
    expect(masked).not.toContain("2079");
  });

  it("never leaks the middle digits", () => {
    expect(maskPhoneNumber("+18622984988")).not.toContain("298");
  });

  it("renders nothing for nothing", () => {
    expect(maskPhoneNumber(null)).toBe("");
  });
});
