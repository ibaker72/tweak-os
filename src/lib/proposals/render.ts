import { SECTION_ORDER, SECTION_TITLES, type ProposalSections } from "./types";

// ============================================
// Light-themed proposal renderer for email body and PDF.
// Self-contained: zero classes, all inline styles, safe for email clients.
// ============================================

const LIME = "#65a30d";
const LIME_LIGHT = "#ecfccb";
const TEXT = "#0f172a";
const MUTED = "#475569";
const BORDER = "#e2e8f0";

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
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      `<a href="$2" style="color:${LIME};text-decoration:underline;">$1</a>`
    );
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
        `<ol style="margin:8px 0 16px 24px;padding:0;color:${TEXT};font-size:14px;line-height:1.6;">${items
          .map((it) => `<li style="margin:6px 0;">${applyInline(it)}</li>`)
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
        `<ul style="margin:8px 0 16px 24px;padding:0;color:${TEXT};font-size:14px;line-height:1.6;">${items
          .map((it) => `<li style="margin:6px 0;">${applyInline(it)}</li>`)
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
      !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      `<p style="margin:0 0 12px 0;color:${TEXT};font-size:14px;line-height:1.65;">${applyInline(
        para.join(" ")
      )}</p>`
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

function renderTable(rows: string[]): string {
  if (rows.length < 2) return "";
  const header = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  const headHtml = `<thead><tr>${header
    .map(
      (c) =>
        `<th style="text-align:left;padding:10px 12px;background:${LIME_LIGHT};color:${TEXT};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid ${BORDER};">${applyInline(
          c
        )}</th>`
    )
    .join("")}</tr></thead>`;
  const bodyHtml = `<tbody>${body
    .map(
      (cells, idx) =>
        `<tr style="background:${idx % 2 === 0 ? "#ffffff" : "#fafaf9"};">${cells
          .map(
            (c) =>
              `<td style="padding:10px 12px;font-size:14px;color:${TEXT};border-bottom:1px solid ${BORDER};">${applyInline(
                c
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:12px 0 20px 0;border:1px solid ${BORDER};border-radius:6px;overflow:hidden;">${headHtml}${bodyHtml}</table>`;
}

// ============================================
// Brand header (logo + wordmark, rendered as inline SVG so it survives
// email clients that strip <img> linked sources). Lime square + chevron.
// ============================================
function renderBrandHeader(): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="vertical-align:middle;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="100" height="100" rx="14" fill="${LIME}" />
                  <path d="M42 32L58 50L42 68" stroke="#0a0a0a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </td>
              <td style="vertical-align:middle;">
                <span style="font-family:Inter,Arial,sans-serif;font-size:18px;font-weight:600;color:${TEXT};letter-spacing:-0.01em;">
                  Tweak<span style="color:${LIME};">&amp;Build</span>
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

export interface RenderProposalOptions {
  sections: ProposalSections;
  clientName: string;
  websiteUrl?: string;
}

/**
 * Render a full, brand-styled, email/PDF-safe HTML document. Always
 * uses the light theme — white background, near-black text, lime
 * accents — regardless of where the user reads it.
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

  const sectionsHtml = SECTION_ORDER
    .map((key) => {
      const body = sections[key]?.trim();
      if (!body) return "";
      const title = SECTION_TITLES[key];
      return `
        <section style="margin:32px 0;">
          <h2 style="font-family:Inter,Arial,sans-serif;font-size:18px;font-weight:700;color:${TEXT};margin:0 0 4px 0;letter-spacing:-0.01em;">${escapeHtml(
        title
      )}</h2>
          <div style="height:3px;width:32px;background:${LIME};border-radius:2px;margin:0 0 14px 0;"></div>
          ${renderSectionBody(body)}
        </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Proposal — ${safeClient}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#f1f5f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid ${BORDER};">
          <tr>
            <td style="padding:28px 36px 18px 36px;border-bottom:1px solid ${BORDER};">
              ${renderBrandHeader()}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 36px 12px 36px;">
              <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};font-weight:600;">Proposal</p>
              <h1 style="margin:6px 0 4px 0;font-family:Inter,Arial,sans-serif;font-size:26px;font-weight:700;letter-spacing:-0.02em;color:${TEXT};">${safeClient}</h1>
              ${safeUrl ? `<p style="margin:0;color:${MUTED};font-size:13px;">${safeUrl}</p>` : ""}
              <p style="margin:10px 0 0 0;color:${MUTED};font-size:12px;">${date}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 36px 24px 36px;">
              ${sectionsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 36px 24px 36px;border-top:1px solid ${BORDER};background:#fafaf9;">
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="font-size:12px;color:${MUTED};">
                    Tweak &amp; Build · New Jersey
                  </td>
                  <td align="right" style="font-size:12px;">
                    <a href="https://tweakandbuild.com" style="color:${LIME};text-decoration:none;font-weight:600;">tweakandbuild.com</a>
                  </td>
                </tr>
              </table>
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
 * Render just the proposal sections as a styled fragment — used inside
 * the email body underneath the personal note from Iyad.
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
  const messageHtml = escapeHtml(message)
    .split(/\r?\n\r?\n/)
    .map((para) => `<p style="margin:0 0 14px 0;color:${TEXT};font-size:15px;line-height:1.6;">${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");

  const sectionsHtml = SECTION_ORDER
    .map((key) => {
      const body = sections[key]?.trim();
      if (!body) return "";
      const title = SECTION_TITLES[key];
      return `
        <section style="margin:24px 0;">
          <h2 style="font-family:Inter,Arial,sans-serif;font-size:16px;font-weight:700;color:${TEXT};margin:0 0 4px 0;">${escapeHtml(
        title
      )}</h2>
          <div style="height:2px;width:28px;background:${LIME};border-radius:2px;margin:0 0 10px 0;"></div>
          ${renderSectionBody(body)}
        </section>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Arial,Helvetica,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;background:#fff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
        <tr><td style="padding:24px 32px 14px 32px;border-bottom:1px solid ${BORDER};">${renderBrandHeader()}</td></tr>
        <tr><td style="padding:22px 32px 4px 32px;">
          <p style="margin:0 0 14px 0;color:${TEXT};font-size:15px;line-height:1.6;">Hi ${safeRecipient},</p>
          ${messageHtml}
        </td></tr>
        <tr><td style="padding:10px 32px 0 32px;">
          <div style="border-top:1px dashed ${BORDER};padding-top:14px;">
            <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};font-weight:600;">Proposal Preview</p>
            <h1 style="margin:4px 0 0 0;font-family:Inter,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${TEXT};">${safeClient}</h1>
          </div>
        </td></tr>
        <tr><td style="padding:0 32px 18px 32px;">${sectionsHtml}</td></tr>
        <tr><td style="padding:18px 32px 22px 32px;border-top:1px solid ${BORDER};background:#fafaf9;">
          <p style="margin:0;font-size:12px;color:${MUTED};">
            Sent via Tweak &amp; Build OS ·
            <a href="https://tweakandbuild.com" style="color:${LIME};text-decoration:none;font-weight:600;">tweakandbuild.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
