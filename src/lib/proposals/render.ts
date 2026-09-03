import { SECTION_ORDER, SECTION_TITLES, type ProposalSections } from "./types";
import {
  PROPOSAL_FONT,
  PROPOSAL_THEME,
  accentRuleHtml,
  bodyStyle,
  ctaButtonHtml,
  linkStyle,
  tableStyles,
} from "./theme";

// ============================================
// Dark, brand-themed proposal renderer for the email body and the
// stored proposal document. Self-contained: zero classes, all inline
// styles, safe for email clients. Palette comes from ./theme, which
// mirrors the real Tweak & Build tokens in globals.css + Logo.tsx.
// ============================================

const {
  background: BG,
  surface: CARD,
  surfaceRaised: RAISED,
  accent: ACCENT,
  accentSolid: ACCENT_SOLID,
  onAccent: ON_ACCENT,
  text: TEXT,
  textBody: BODY,
  textMuted: MUTED,
  border: BORDER,
  borderStrong: BORDER_STRONG,
} = PROPOSAL_THEME;

const SITE_URL = "https://tweakandbuild.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:600;color:${TEXT};">$1</strong>`)
    .replace(/\*([^*]+)\*/g, '<em style="font-style:italic;">$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="${linkStyle}">$1</a>`);
}

function renderSectionBody(md: string): string {
  if (!md.trim()) return "";
  const safe = escapeHtml(md);
  const lines = safe.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      out.push(renderTable(rows));
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(
        `<ol style="margin:10px 0 18px 22px;padding:0;${bodyStyle}">${items
          .map((it) => `<li style="margin:8px 0;padding-left:4px;">${applyInline(it)}</li>`)
          .join("")}</ol>`
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul style="margin:10px 0 18px 22px;padding:0;${bodyStyle}">${items
          .map((it) => `<li style="margin:8px 0;padding-left:4px;">${applyInline(it)}</li>`)
          .join("")}</ul>`
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^([-*]\s+|\d+\.\s+)/.test(lines[i]) &&
      // A line opening with a bold label (the Investment Summary totals)
      // starts its own paragraph instead of running onto the previous one.
      !/^\s*\*\*/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      `<p style="margin:0 0 14px 0;${bodyStyle}">${applyInline(para.join(" "))}</p>`
    );
  }
  return out.join("\n");
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}
function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s:|-]+\|?\s*$/.test(line);
}
function splitRow(row: string): string[] {
  return row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/**
 * Investment-summary-grade table: charcoal header with a lime label row,
 * white values, hairline zinc dividers. No tinted row fills — the dark
 * card shows through, so nothing can read as olive.
 */
function renderTable(rows: string[]): string {
  if (rows.length < 2) return "";
  const header = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  const headHtml = `<thead><tr>${header
    .map((c) => `<th style="${tableStyles.th}">${applyInline(c)}</th>`)
    .join("")}</tr></thead>`;
  const lastIdx = body.length - 1;
  const bodyHtml = `<tbody>${body
    .map(
      (cells, idx) =>
        `<tr>${cells
          .map(
            (c) =>
              `<td style="${idx === lastIdx ? tableStyles.tdLast : tableStyles.td}">${applyInline(
                c
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody>`;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" class="tb-table" style="${tableStyles.wrapper}">${headHtml}${bodyHtml}</table>`;
}

// ============================================
// Brand header — inline SVG mark (survives clients that strip remote
// <img> sources) + the "Tweak&Build" wordmark and lime "OS" pill,
// matching src/components/brand/Logo.tsx exactly.
// ============================================
function renderBrandHeader(): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">
      <tr>
        <td style="vertical-align:middle;padding-right:10px;line-height:0;">
          <svg width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="100" height="100" rx="14" fill="${ACCENT_SOLID}" />
            <path d="M42 32L58 50L42 68" stroke="${ON_ACCENT}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          </svg>
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:${PROPOSAL_FONT};font-size:17px;font-weight:600;color:${TEXT};letter-spacing:-0.01em;">Tweak<span style="color:${ACCENT};">&amp;Build</span></span>
        </td>
        <td style="vertical-align:middle;padding-left:7px;">
          <span style="display:inline-block;padding:3px 6px;border:1px solid ${BORDER_STRONG};border-radius:5px;background:${RAISED};font-family:${PROPOSAL_FONT};font-size:10px;font-weight:700;line-height:1;letter-spacing:0.09em;color:${ACCENT};">OS</span>
        </td>
      </tr>
    </table>`;
}

function renderEyebrow(label: string): string {
  return `<p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};font-weight:700;">${label}</p>`;
}

/** Footer band: muted attribution on the left, lime CTA button on the right. */
function renderFooter(): string {
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;border-collapse:collapse;">
    <tr>
      <td class="tb-stack" style="vertical-align:middle;font-family:${PROPOSAL_FONT};font-size:13px;color:${MUTED};line-height:1.6;">
        Sent via Tweak &amp; Build OS
      </td>
      <td align="right" class="tb-stack tb-stack-gap" style="vertical-align:middle;padding-left:12px;">
        ${ctaButtonHtml({ href: SITE_URL, label: "tweakandbuild.com" })}
      </td>
    </tr>
  </table>`;
}

/**
 * Shared <head>. `color-scheme: dark` stops iOS Mail / Outlook dark mode
 * from re-inverting an already-dark email.
 */
function renderHead(title: string): string {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    a { color: ${ACCENT}; }
    table { max-width: 100%; }
    td, th, p, li, h1, h2 { overflow-wrap: break-word; }
    @media (max-width: 620px) {
      .tb-outer { padding: 16px 8px !important; }
      .tb-pad { padding-left: 18px !important; padding-right: 18px !important; }
      .tb-table th { padding: 9px 8px !important; font-size: 10px !important; letter-spacing: 0.04em !important; }
      .tb-table td { padding: 10px 8px !important; font-size: 13px !important; }
      .tb-h1 { font-size: 22px !important; }
      .tb-stack { display: block !important; width: 100% !important; text-align: left !important; padding-left: 0 !important; }
      .tb-stack-gap { padding-top: 12px !important; }
    }
  </style>
</head>`;
}

function renderSections(
  sections: ProposalSections,
  opts: { titleSize: number; margin: string; ruleWidth: number }
): string {
  return SECTION_ORDER.map((key) => {
    const body = sections[key]?.trim();
    if (!body) return "";
    const title = SECTION_TITLES[key];
    return `
        <section style="margin:${opts.margin};">
          <h2 style="font-family:${PROPOSAL_FONT};font-size:${opts.titleSize}px;font-weight:700;color:${TEXT};margin:0 0 8px 0;letter-spacing:-0.01em;">${escapeHtml(
      title
    )}</h2>
          <div style="height:3px;width:${opts.ruleWidth}px;background:${ACCENT};border-radius:2px;margin:0 0 16px 0;line-height:3px;font-size:0;">&nbsp;</div>
          ${renderSectionBody(body)}
        </section>`;
  }).join("\n");
}

export interface RenderProposalOptions {
  sections: ProposalSections;
  clientName: string;
  websiteUrl?: string;
}

/**
 * Render a full, brand-styled, email/PDF-safe HTML document — near-black
 * canvas, charcoal card, acid-lime accents, white headings — matching
 * the Tweak & Build OS app regardless of where the client reads it.
 */
export function renderProposalDocumentHtml(opts: RenderProposalOptions): string {
  const { sections, clientName, websiteUrl } = opts;
  const safeClient = escapeHtml(clientName || "Your Business");
  const safeUrl = websiteUrl ? escapeHtml(websiteUrl) : null;
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const sectionsHtml = renderSections(sections, {
    titleSize: 18,
    margin: "30px 0",
    ruleWidth: 36,
  });

  return `<!doctype html>
<html lang="en">
${renderHead(`Proposal — ${safeClient}`)}
<body style="margin:0;padding:0;background:${BG};font-family:${PROPOSAL_FONT};-webkit-font-smoothing:antialiased;color:${BODY};">
  <table cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${BG}" style="width:100%;border-collapse:collapse;background:${BG};">
    <tr>
      <td align="center" class="tb-outer" style="padding:28px 12px;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${CARD}" style="width:100%;max-width:680px;background:${CARD};border-radius:14px;overflow:hidden;border:1px solid ${BORDER};">
          <tr>
            <td class="tb-pad" style="padding:26px 32px 18px 32px;">
              ${renderBrandHeader()}
              ${accentRuleHtml(44, 16)}
            </td>
          </tr>
          <tr>
            <td class="tb-pad" style="padding:8px 32px 4px 32px;">
              ${renderEyebrow("Proposal")}
              <h1 class="tb-h1" style="margin:6px 0 4px 0;font-family:${PROPOSAL_FONT};font-size:26px;font-weight:700;letter-spacing:-0.02em;color:${TEXT};">${safeClient}</h1>
              ${safeUrl ? `<p style="margin:4px 0 0 0;color:${MUTED};font-size:14px;">${safeUrl}</p>` : ""}
              <p style="margin:8px 0 0 0;color:${MUTED};font-size:13px;">${date}</p>
            </td>
          </tr>
          <tr>
            <td class="tb-pad" style="padding:8px 32px 28px 32px;">
              ${sectionsHtml}
            </td>
          </tr>
          <tr>
            <td class="tb-pad" bgcolor="${RAISED}" style="padding:18px 32px 22px 32px;border-top:1px solid ${BORDER};background:${RAISED};">
              ${renderFooter()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Returns true when the message body already opens with a greeting like
 * "Hi", "Hey", "Hello", "Dear", or the recipient's own name — so the
 * wrapper shouldn't prepend its own "Hi {name}," line.
 */
export function messageHasOwnGreeting(
  message: string,
  recipientName: string
): boolean {
  const trimmed = message.trimStart();
  if (/^(hi|hey|hello|dear)\b/i.test(trimmed)) return true;
  const name = recipientName.trim();
  if (name && trimmed.toLowerCase().startsWith(name.toLowerCase())) return true;
  return false;
}

/**
 * Render the proposal email body — Iyad's personal note up top, then a
 * styled "Proposal Preview" section. Tuned for Gmail mobile: near-black
 * outer, charcoal card, generous padding, 15–16px copy.
 */
export function renderProposalEmailBody(opts: {
  sections: ProposalSections;
  clientName: string;
  recipientName: string;
  message: string;
}): string {
  const { sections, clientName, recipientName, message } = opts;
  const safeClient = escapeHtml(clientName || "your business");
  const safeRecipient = escapeHtml(recipientName || "there");
  const hasOwnGreeting = messageHasOwnGreeting(message, recipientName);
  const messageHtml = escapeHtml(message)
    .split(/\r?\n\r?\n/)
    .map(
      (para) =>
        `<p style="margin:0 0 16px 0;color:${BODY};font-size:16px;line-height:1.65;">${para.replace(
          /\n/g,
          "<br/>"
        )}</p>`
    )
    .join("");

  const sectionsHtml = renderSections(sections, {
    titleSize: 17,
    margin: "24px 0",
    ruleWidth: 32,
  });

  return `<!doctype html>
<html lang="en">
${renderHead(`Proposal — ${safeClient}`)}
<body style="margin:0;padding:0;background:${BG};font-family:${PROPOSAL_FONT};-webkit-font-smoothing:antialiased;color:${BODY};">
  <table cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${BG}" style="width:100%;border-collapse:collapse;background:${BG};">
    <tr><td align="center" class="tb-outer" style="padding:28px 12px;">
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${CARD}" style="width:100%;max-width:640px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
        <tr><td class="tb-pad" style="padding:26px 28px 18px 28px;">
          ${renderBrandHeader()}
          ${accentRuleHtml(44, 16)}
        </td></tr>
        <tr><td class="tb-pad" style="padding:22px 28px 8px 28px;">
          ${hasOwnGreeting ? "" : `<p style="margin:0 0 16px 0;color:${BODY};font-size:16px;line-height:1.65;">Hi ${safeRecipient},</p>`}
          ${messageHtml}
        </td></tr>
        <tr><td class="tb-pad" style="padding:12px 28px 0 28px;">
          <div style="border-top:1px solid ${BORDER};padding-top:18px;">
            ${renderEyebrow("Proposal Preview")}
            <h1 class="tb-h1" style="margin:6px 0 0 0;font-family:${PROPOSAL_FONT};font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${TEXT};">${safeClient}</h1>
          </div>
        </td></tr>
        <tr><td class="tb-pad" style="padding:4px 28px 20px 28px;">${sectionsHtml}</td></tr>
        <tr><td class="tb-pad" bgcolor="${RAISED}" style="padding:20px 28px 24px 28px;border-top:1px solid ${BORDER};background:${RAISED};">
          ${renderFooter()}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
