import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------
// Mock the twilio helper so a wandering call would fail loudly.
// The disabled-path tests assert the spy is NEVER called.
// ---------------------------------------------------------------
const twilioCreateMessage = vi.fn();
vi.mock("./twilio", () => ({
  twilioCreateMessage: (...args: unknown[]) => twilioCreateMessage(...args),
}));

const { sendSms } = await import("./service");

interface MockChain {
  insertedRows: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

function makeSupabase(): { client: SupabaseClient; tracker: MockChain } {
  const tracker: MockChain = { insertedRows: [], updates: [] };

  const client = {
    from(table: string) {
      if (table === "sms_messages") {
        return {
          insert(row: Record<string, unknown>) {
            tracker.insertedRows.push({ table, ...row });
            return {
              select() {
                return {
                  single: async () => ({ data: { id: `id-${tracker.insertedRows.length}` }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === "leads") {
        return {
          update(values: Record<string, unknown>) {
            tracker.updates.push({ table, values });
            return {
              eq: async () => ({ data: null, error: null }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, tracker };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  twilioCreateMessage.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SMS_SENDING_ENABLED;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  delete process.env.TWILIO_FROM_NUMBER;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("sendSms — disabled mode", () => {
  it("never calls Twilio when SMS_SENDING_ENABLED is unset", async () => {
    const { client, tracker } = makeSupabase();
    const result = await sendSms(client, {
      to: "+18622984988",
      body: "Test",
      lead_id: "lead-1",
    });
    expect(twilioCreateMessage).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe("disabled");
    expect(result.reason).toBe("disabled");
    // The disabled attempt is logged, but no last_sms_sent_at update.
    expect(tracker.insertedRows).toHaveLength(1);
    expect(tracker.insertedRows[0]).toMatchObject({ status: "disabled" });
    expect(tracker.updates).toHaveLength(0);
  });

  it("never calls Twilio when SMS_SENDING_ENABLED=false", async () => {
    process.env.SMS_SENDING_ENABLED = "false";
    const { client } = makeSupabase();
    await sendSms(client, { to: "+18622984988", body: "Test" });
    expect(twilioCreateMessage).not.toHaveBeenCalled();
  });
});

describe("sendSms — input validation", () => {
  it("blocks an empty body", async () => {
    const { client, tracker } = makeSupabase();
    const result = await sendSms(client, { to: "+18622984988", body: "   " });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("blocked_empty_body");
    expect(tracker.insertedRows[0]).toMatchObject({ status: "blocked" });
    expect(twilioCreateMessage).not.toHaveBeenCalled();
  });

  it("blocks an invalid phone number", async () => {
    const { client, tracker } = makeSupabase();
    const result = await sendSms(client, { to: "not-a-phone", body: "hi" });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("blocked_invalid_phone");
    expect(tracker.insertedRows[0]).toMatchObject({ status: "blocked" });
    expect(twilioCreateMessage).not.toHaveBeenCalled();
  });
});

describe("sendSms — enabled mode", () => {
  it("calls Twilio and writes sent_at when SMS_SENDING_ENABLED=true", async () => {
    process.env.SMS_SENDING_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG456";

    twilioCreateMessage.mockResolvedValue({ sid: "SM999", status: "queued" });

    const { client, tracker } = makeSupabase();
    const result = await sendSms(client, {
      to: "+18622984988",
      body: "Hello",
      lead_id: "lead-1",
    });

    expect(twilioCreateMessage).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("sent");
    expect(result.twilio_message_sid).toBe("SM999");
    expect(tracker.insertedRows[0]).toMatchObject({
      status: "sent",
      twilio_message_sid: "SM999",
    });
    expect(tracker.updates).toHaveLength(1);
    expect(tracker.updates[0]).toMatchObject({ table: "leads" });
    expect((tracker.updates[0].values as Record<string, unknown>).last_sms_sent_at).toBeTruthy();
  });

  it("records a failed status when Twilio throws", async () => {
    process.env.SMS_SENDING_ENABLED = "true";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "secret";
    process.env.TWILIO_FROM_NUMBER = "+15551234567";

    twilioCreateMessage.mockRejectedValue(new Error("boom"));

    const { client, tracker } = makeSupabase();
    const result = await sendSms(client, { to: "+18622984988", body: "Hi" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("failed");
    expect(tracker.insertedRows[0]).toMatchObject({ status: "failed", error_message: "boom" });
  });
});
