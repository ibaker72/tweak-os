import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isSmsSendingEnabled,
  normalizePhoneNumber,
  isValidPhoneNumber,
  readSmsConfig,
} from "./config";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SMS_SENDING_ENABLED;
  delete process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("isSmsSendingEnabled", () => {
  it("returns true only when SMS_SENDING_ENABLED is the string 'true'", () => {
    expect(isSmsSendingEnabled()).toBe(false);
    process.env.SMS_SENDING_ENABLED = "false";
    expect(isSmsSendingEnabled()).toBe(false);
    process.env.SMS_SENDING_ENABLED = "1";
    expect(isSmsSendingEnabled()).toBe(false);
    process.env.SMS_SENDING_ENABLED = "true";
    expect(isSmsSendingEnabled()).toBe(true);
  });
});

describe("readSmsConfig.validateSignature", () => {
  it("defaults to true", () => {
    expect(readSmsConfig().validateSignature).toBe(true);
  });
  it("becomes false only when explicitly set to 'false'", () => {
    process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "false";
    expect(readSmsConfig().validateSignature).toBe(false);
    process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "true";
    expect(readSmsConfig().validateSignature).toBe(true);
  });
});

describe("normalizePhoneNumber", () => {
  it("returns null for empty / nonsense input", () => {
    expect(normalizePhoneNumber("")).toBeNull();
    expect(normalizePhoneNumber(null)).toBeNull();
    expect(normalizePhoneNumber("abc")).toBeNull();
    expect(normalizePhoneNumber("123")).toBeNull();
  });

  it("preserves already-normalized E.164 numbers", () => {
    expect(normalizePhoneNumber("+18622984988")).toBe("+18622984988");
  });

  it("prepends +1 for raw 10-digit US numbers", () => {
    expect(normalizePhoneNumber("8622984988")).toBe("+18622984988");
    expect(normalizePhoneNumber("(862) 298-4988")).toBe("+18622984988");
  });

  it("handles 11-digit US numbers starting with 1", () => {
    expect(normalizePhoneNumber("18622984988")).toBe("+18622984988");
  });

  it("isValidPhoneNumber agrees with normalizePhoneNumber", () => {
    expect(isValidPhoneNumber("+18622984988")).toBe(true);
    expect(isValidPhoneNumber("8622984988")).toBe(true);
    expect(isValidPhoneNumber("nope")).toBe(false);
    expect(isValidPhoneNumber(null)).toBe(false);
  });
});
