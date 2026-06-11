import { describe, expect, it } from "vitest";
import { messageHasOwnGreeting, renderProposalEmailBody } from "./render";
import { emptySections } from "./sections";

describe("messageHasOwnGreeting", () => {
  it("detects a leading 'Hi'", () => {
    expect(messageHasOwnGreeting("Hi Joe,\n\nhere is the plan.", "Joe")).toBe(true);
  });

  it("detects a leading 'Hey' regardless of case", () => {
    expect(messageHasOwnGreeting("hey there,\n\nhere is the plan.", "Joe")).toBe(true);
  });

  it("detects a leading 'Hello'", () => {
    expect(messageHasOwnGreeting("Hello Joe,\n\nplan attached.", "Joe")).toBe(true);
  });

  it("detects a leading 'Dear'", () => {
    expect(messageHasOwnGreeting("Dear Joe,\n\nplan attached.", "Joe")).toBe(true);
  });

  it("detects when the message starts with the recipient name", () => {
    expect(messageHasOwnGreeting("Joe — quick plan attached.", "Joe")).toBe(true);
  });

  it("tolerates leading whitespace", () => {
    expect(messageHasOwnGreeting("   Hi Joe,\n\nhere is the plan.", "Joe")).toBe(true);
  });

  it("returns false when the message dives straight into the body", () => {
    expect(
      messageHasOwnGreeting("I put together a quick plan for you.", "Joe")
    ).toBe(false);
  });

  it("does not match partial words like 'highlights'", () => {
    expect(messageHasOwnGreeting("highlights of the audit:", "Joe")).toBe(false);
  });
});

describe("renderProposalEmailBody", () => {
  const sections = { ...emptySections(), executive_summary: "Solid site." };

  it("does NOT prepend 'Hi {name},' when the message already has a greeting", () => {
    const html = renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "Joe",
      message: "Hey Joe,\n\nplan attached.",
    });
    // Wrapper greeting should not appear — only the user's own "Hey Joe,".
    expect(html).not.toMatch(/>Hi Joe,</);
    expect(html).toContain("Hey Joe,");
  });

  it("DOES prepend 'Hi {name},' when the message has no greeting of its own", () => {
    const html = renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "Joe",
      message: "I put together a quick plan for you.",
    });
    expect(html).toContain("Hi Joe,");
    expect(html).toContain("I put together a quick plan");
  });

  it("falls back to 'there' when no recipient name is provided and no greeting in message", () => {
    const html = renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "",
      message: "Quick plan attached.",
    });
    expect(html).toContain("Hi there,");
  });
});
