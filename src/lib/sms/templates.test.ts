import { describe, it, expect } from "vitest";
import {
  SMS_TEMPLATES,
  fillSmsTemplate,
  isOptOutKeyword,
  isHelpKeyword,
  OPT_OUT_KEYWORDS,
} from "./templates";

describe("SMS templates", () => {
  it("every starter template includes the Tweak & Build brand and STOP language", () => {
    for (const template of SMS_TEMPLATES) {
      expect(template.body).toContain("Tweak & Build");
      expect(template.body).toContain("Reply STOP");
    }
  });

  it("fillSmsTemplate replaces the supported variables", () => {
    const template = SMS_TEMPLATES.find((t) => t.id === "proposal-followup");
    expect(template).toBeDefined();
    const filled = fillSmsTemplate(template!, {
      first_name: "Jamie",
      proposal_link: "https://tweakandbuild.com/p/abc",
    });
    expect(filled).toContain("Hi Jamie");
    expect(filled).toContain("https://tweakandbuild.com/p/abc");
    expect(filled).not.toContain("{{first_name}}");
    expect(filled).not.toContain("{{proposal_link}}");
  });

  it("falls back to 'there' for missing first name", () => {
    const template = SMS_TEMPLATES.find((t) => t.id === "quick-checkin");
    const filled = fillSmsTemplate(template!, {});
    expect(filled).toContain("Hi there");
  });
});

describe("opt-out keyword detection", () => {
  it.each(OPT_OUT_KEYWORDS)("matches %s exactly", (keyword) => {
    expect(isOptOutKeyword(keyword)).toBe(true);
    expect(isOptOutKeyword(keyword.toLowerCase())).toBe(true);
    expect(isOptOutKeyword(`  ${keyword}  `)).toBe(true);
  });

  it("does not match keywords inside a longer message", () => {
    expect(isOptOutKeyword("STOP BY")).toBe(false);
    expect(isOptOutKeyword("Please cancel my order")).toBe(false);
  });

  it("ignores empty / null input", () => {
    expect(isOptOutKeyword("")).toBe(false);
    expect(isOptOutKeyword(null)).toBe(false);
    expect(isOptOutKeyword(undefined)).toBe(false);
  });
});

describe("HELP keyword detection", () => {
  it("matches HELP exactly, case insensitive", () => {
    expect(isHelpKeyword("HELP")).toBe(true);
    expect(isHelpKeyword("help")).toBe(true);
    expect(isHelpKeyword(" Help ")).toBe(true);
  });

  it("does not match HELP inside other messages", () => {
    expect(isHelpKeyword("can you help?")).toBe(false);
  });
});
