import { describe, it, expect } from "vitest";
import { normalizeOutreach } from "./outreach";

describe("normalizeOutreach", () => {
  it("returns empty result for invalid JSON", () => {
    const result = normalizeOutreach("not json");
    expect(result.pain_points).toEqual([]);
    expect(result.email_body).toBe("");
  });

  it("strips markdown code fences before parsing", () => {
    const raw = '```json\n{"pain_points": ["a"], "offer_angle": "x", "cold_call_opener": "", "sms": "", "email_subject": "", "email_body": "body", "follow_up_email": "", "next_best_action": "call"}\n```';
    const result = normalizeOutreach(raw);
    expect(result.pain_points).toEqual(["a"]);
    expect(result.email_body).toBe("body");
    expect(result.next_best_action).toBe("call");
  });

  it("drops non-string array entries and caps pain_points length", () => {
    const obj = {
      pain_points: ["a", 1, null, "b", "c", "d", "e", "f", "g"],
      offer_angle: "fit",
      cold_call_opener: "hi",
      sms: "ok",
      email_subject: "s",
      email_body: "b",
      follow_up_email: "f",
      next_best_action: "n",
    };
    const result = normalizeOutreach(JSON.stringify(obj));
    expect(result.pain_points).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("returns empty strings for missing fields without crashing", () => {
    const result = normalizeOutreach("{}");
    expect(result.email_body).toBe("");
    expect(result.sms).toBe("");
    expect(result.pain_points).toEqual([]);
  });
});
