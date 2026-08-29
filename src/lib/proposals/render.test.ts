import { describe, expect, it } from "vitest";
import { messageHasOwnGreeting, renderProposalEmailBody } from "./render";
import { emptySections } from "./sections";
import { buildInvestmentSummary } from "./services";

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

  it("includes the 'Sent via Tweak & Build OS' footer with tweakandbuild.com link", () => {
    const html = renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "Joe",
      message: "Quick plan attached.",
    });
    expect(html).toContain("Sent via Tweak &amp; Build OS");
    expect(html).toContain("tweakandbuild.com");
  });

  it("uses the soft off-white outer background, not a dark app theme", () => {
    const html = renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "Joe",
      message: "Quick plan attached.",
    });
    // Mobile premium look — soft off-white, not slate-200.
    expect(html).toContain("#f7f8f5");
    expect(html).not.toMatch(/background:#f1f5f9/);
  });
});

describe("investment table rendering", () => {
  function investmentHtml(services: unknown): string {
    return renderProposalEmailBody({
      sections: {
        ...emptySections(),
        investment_summary: buildInvestmentSummary(services),
      },
      clientName: "Acme",
      recipientName: "Joe",
      message: "Quick plan attached.",
    });
  }

  it("renders the one-time / monthly columns for a current proposal", () => {
    const html = investmentHtml([
      { name: "Custom Business Website", one_time_price: 4800 },
      { name: "Local SEO / City Pages", monthly_price: 750 },
    ]);
    expect(html).toContain("One-Time");
    expect(html).toContain("Monthly");
    expect(html).toContain("$4,800");
    expect(html).toContain("$750/month");
    expect(html).toContain("Total One-Time Investment:");
    expect(html).toContain("Monthly Ongoing Investment:");
  });

  it("renders a historical proposal's legacy line items with their amounts", () => {
    const html = investmentHtml([
      { name: "Premium Growth Package", price: 8500, billing: "one-time" },
      { name: "Growth Partnership", price: 4500, billing: "monthly" },
    ]);
    expect(html).toContain("Premium Growth Package");
    expect(html).toContain("$8,500");
    expect(html).toContain("Growth Partnership");
    expect(html).toContain("$4,500/month");
  });
});
