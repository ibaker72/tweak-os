import { describe, expect, it } from "vitest";
import {
  messageHasOwnGreeting,
  renderProposalDocumentHtml,
  renderProposalEmailBody,
} from "./render";
import { PROPOSAL_THEME } from "./theme";
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

  it("uses the near-black brand canvas, not the old off-white shell", () => {
    const html = renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "Joe",
      message: "Quick plan attached.",
    });
    // globals.css --background, on both the CSS and the Outlook bgcolor attr.
    expect(html).toContain(PROPOSAL_THEME.background);
    expect(html).toContain(`bgcolor="${PROPOSAL_THEME.background}"`);
    expect(html).not.toContain("#f7f8f5");
    expect(html).not.toContain("#ffffff");
  });
});

describe("brand palette", () => {
  const sections = {
    ...emptySections(),
    executive_summary: "Solid site. See [our work](https://tweakandbuild.com).",
  };

  function html(): string {
    return renderProposalEmailBody({
      sections,
      clientName: "Acme",
      recipientName: "Joe",
      message: "Quick plan attached.",
    });
  }

  // The exact tones the pre-brand proposal shipped with. If any of these
  // reappear the proposal has drifted off-brand again.
  const OFF_BRAND = [
    "#65a30d", // olive lime-600
    "#84cc16", // lime-500
    "#f7fee7", // pale lime wash
    "#ecfccb", // pale lime wash
    "#f7f8f5", // warm off-white shell
    "#fafaf7", // warm zebra row
    "#0f172a", // slate ink
    "#111827", // gray ink
    "#4b5563", // gray muted
    "#e5e7eb", // gray border
  ];

  it("uses the app's acid-lime accent everywhere and no off-brand green", () => {
    const out = html();
    expect(out).toContain(PROPOSAL_THEME.accent); // #d1f526, globals.css --accent
    for (const hex of OFF_BRAND) {
      expect(out).not.toContain(hex);
    }
  });

  it("renders links in the accent lime", () => {
    expect(html()).toContain(
      `<a href="https://tweakandbuild.com" style="color:${PROPOSAL_THEME.accent};text-decoration:underline;">our work</a>`
    );
  });

  it("renders a lime CTA button matching the site's primary button", () => {
    const out = html();
    expect(out).toContain(`bgcolor="${PROPOSAL_THEME.accentSolid}"`);
    expect(out).toContain(`color:${PROPOSAL_THEME.onAccent}`);
  });

  it("declares a dark color-scheme so mail clients do not re-invert it", () => {
    const out = html();
    expect(out).toContain('<meta name="color-scheme" content="dark" />');
    expect(out).toContain('<meta name="supported-color-schemes" content="dark" />');
  });

  it("carries the Tweak&Build mark, wordmark and OS pill in the header", () => {
    const out = html();
    expect(out).toContain(`fill="${PROPOSAL_THEME.accentSolid}"`); // logo square
    expect(out).toContain("M42 32L58 50L42 68"); // logo chevron
    expect(out).toContain("&amp;Build");
    expect(out).toContain(">OS</span>");
  });

  it("styles the full proposal document with the same palette as the email", () => {
    const doc = renderProposalDocumentHtml({ sections, clientName: "Acme" });
    expect(doc).toContain(PROPOSAL_THEME.background);
    expect(doc).toContain(PROPOSAL_THEME.accent);
    for (const hex of OFF_BRAND) {
      expect(doc).not.toContain(hex);
    }
  });
});

describe("investment summary table styling", () => {
  const table = [
    "| Service | One-Time | Monthly |",
    "| --- | --- | --- |",
    "| Custom Business Website | $4,800 | — |",
    "| Local SEO | — | $750/month |",
  ].join("\n");

  function tableHtml(): string {
    return renderProposalEmailBody({
      sections: { ...emptySections(), investment_summary: table },
      clientName: "Acme",
      recipientName: "Joe",
      message: "Quick plan attached.",
    });
  }

  it("gives the header a charcoal fill with lime label text", () => {
    const out = tableHtml();
    expect(out).toContain(
      `background:${PROPOSAL_THEME.surfaceRaised};color:${PROPOSAL_THEME.accent}`
    );
  });

  it("renders values in white on subtle gray dividers, with no tinted rows", () => {
    const out = tableHtml();
    expect(out).toContain(
      `color:${PROPOSAL_THEME.text};border-bottom:1px solid ${PROPOSAL_THEME.border}`
    );
    // No zebra striping — the dark card shows through every row.
    expect(out).not.toMatch(/<tr style="background:/);
  });

  it("drops the divider under the final row", () => {
    const out = tableHtml();
    expect(out).toContain(
      `<td style="padding:12px 14px;font-size:15px;line-height:1.5;color:${PROPOSAL_THEME.text};">$750/month</td>`
    );
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
