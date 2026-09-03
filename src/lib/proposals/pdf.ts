import { jsPDF } from "jspdf";
import {
  SECTION_ORDER,
  SECTION_TITLES,
  type ProposalSections,
} from "./types";
import { PDF_THEME } from "./theme";

// Brand palette (RGB) — mirrors src/lib/proposals/theme.ts, which mirrors
// the app's real tokens. The PDF is the dark email in print form: near-black
// page, charcoal panels, acid-lime accents, white values.
const {
  background: BG,
  surface: SURFACE,
  surfaceRaised: RAISED,
  accent: ACCENT,
  accentSolid: ACCENT_SOLID,
  onAccent: ON_ACCENT,
  text: TEXT,
  textBody: BODY,
  textMuted: MUTED,
  border: BORDER,
} = PDF_THEME;

const SITE_URL = "https://tweakandbuild.com";

// Page geometry (Letter, in points: 8.5x11 in @ 72dpi = 612x792)
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 64;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

interface PdfState {
  doc: jsPDF;
  y: number;
}

export interface BuildProposalPdfOptions {
  sections: ProposalSections;
  clientName: string;
  websiteUrl?: string;
}

/**
 * Builds a clean, brand-styled PDF for the proposal — near-black page,
 * white headings, lime accent rules, Tweak & Build header, footer with a
 * clickable tweakandbuild.com link. Returns the jsPDF doc so the caller
 * can save it or take the base64 string.
 */
export function buildProposalPdf(opts: BuildProposalPdfOptions): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const state: PdfState = { doc, y: MARGIN_TOP };

  paintPageBackground(doc);
  drawHeader(state, opts.clientName, opts.websiteUrl);

  for (const key of SECTION_ORDER) {
    const body = opts.sections[key]?.trim();
    if (!body) continue;
    drawSection(state, SECTION_TITLES[key], body);
  }

  // Footer on every page.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawFooter(doc, i, pageCount);
  }
  return doc;
}

/**
 * Flood the sheet with the brand near-black. Must run immediately after a
 * page is created, before anything is drawn onto it.
 */
function paintPageBackground(doc: jsPDF) {
  doc.setFillColor(...BG);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function ensureSpace(state: PdfState, needed: number) {
  if (state.y + needed > PAGE_H - MARGIN_BOTTOM) {
    state.doc.addPage();
    paintPageBackground(state.doc);
    state.y = MARGIN_TOP;
  }
}

function drawHeader(state: PdfState, clientName: string, websiteUrl?: string) {
  const { doc } = state;

  // Brand mark — lime rounded square with the dark chevron (Logo.tsx).
  doc.setFillColor(...ACCENT_SOLID);
  doc.roundedRect(MARGIN_X, MARGIN_TOP - 36, 28, 28, 5, 5, "F");
  doc.setDrawColor(...ON_ACCENT);
  doc.setLineWidth(2.6);
  doc.setLineCap("round");
  doc.setLineJoin("round");
  doc.line(MARGIN_X + 11, MARGIN_TOP - 28, MARGIN_X + 17, MARGIN_TOP - 22);
  doc.line(MARGIN_X + 17, MARGIN_TOP - 22, MARGIN_X + 11, MARGIN_TOP - 16);
  doc.setLineCap("butt");
  doc.setLineJoin("miter");

  // Wordmark: white "Tweak" + lime "&Build".
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...TEXT);
  doc.text("Tweak", MARGIN_X + 36, MARGIN_TOP - 16);
  const tweakWidth = doc.getTextWidth("Tweak");
  doc.setTextColor(...ACCENT);
  doc.text("&Build", MARGIN_X + 36 + tweakWidth, MARGIN_TOP - 16);

  // "OS" pill — zinc outline, charcoal fill, lime label (Logo.tsx).
  const buildWidth = doc.getTextWidth("&Build");
  const pillX = MARGIN_X + 36 + tweakWidth + buildWidth + 6;
  const pillY = MARGIN_TOP - 27;
  doc.setFontSize(8);
  const pillW = doc.getTextWidth("OS") + 10;
  doc.setFillColor(...RAISED);
  doc.setDrawColor(...PDF_THEME.borderStrong);
  doc.setLineWidth(0.6);
  doc.roundedRect(pillX, pillY, pillW, 13, 3, 3, "FD");
  doc.setTextColor(...ACCENT);
  doc.text("OS", pillX + 5, pillY + 9);

  // "PROPOSAL" eyebrow
  state.y = MARGIN_TOP + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("PROPOSAL", MARGIN_X, state.y);
  state.y += 6;

  // Client name (big, white)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...TEXT);
  const safeName = clientName || "Your Business";
  doc.text(safeName, MARGIN_X, state.y + 18);
  state.y += 24;

  // Website + date subline
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  if (websiteUrl) {
    doc.text(websiteUrl, MARGIN_X, state.y + 12);
    state.y += 14;
  }
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.text(date, MARGIN_X, state.y + 12);
  state.y += 24;

  // Lime accent stub + hairline rule across the page.
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(2.5);
  doc.line(MARGIN_X, state.y, MARGIN_X + 32, state.y);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_X + 36, state.y, PAGE_W - MARGIN_X, state.y);
  state.y += 12;
}

function drawSection(state: PdfState, title: string, body: string) {
  ensureSpace(state, 60);
  const { doc } = state;

  // Heading — white, matching the email's h2.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...TEXT);
  doc.text(title, MARGIN_X, state.y + 18);
  // Clear the baseline by enough that the accent rule reads as its own
  // element rather than underlining the heading's descenders.
  state.y += 27;

  // Lime accent rule
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(2.5);
  doc.line(MARGIN_X, state.y, MARGIN_X + 26, state.y);
  state.y += 12;

  drawMarkdownBody(state, body);
  state.y += 14;
}

function drawMarkdownBody(state: PdfState, md: string) {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      drawTable(state, rows);
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      items.forEach((item, idx) => drawListItem(state, `${idx + 1}.`, item));
      state.y += 4;
      continue;
    }

    // Bulleted list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      items.forEach((item) => drawListItem(state, "•", item));
      state.y += 4;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (concatenate continuation lines)
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
    drawParagraph(state, para.join(" "));
  }
}

function stripInline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function drawParagraph(state: PdfState, raw: string) {
  const { doc } = state;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...BODY);
  const wrapped = doc.splitTextToSize(stripInline(raw), CONTENT_W);
  for (const wline of wrapped) {
    ensureSpace(state, 16);
    doc.setTextColor(...BODY);
    doc.text(wline, MARGIN_X, state.y + 12);
    state.y += 15;
  }
  state.y += 4;
}

function drawListItem(state: PdfState, marker: string, raw: string) {
  const { doc } = state;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const indent = 14;
  const wrapped = doc.splitTextToSize(stripInline(raw), CONTENT_W - indent);
  for (let j = 0; j < wrapped.length; j++) {
    ensureSpace(state, 16);
    if (j === 0) {
      doc.setTextColor(...ACCENT);
      doc.text(marker, MARGIN_X, state.y + 12);
    }
    doc.setTextColor(...BODY);
    doc.text(wrapped[j], MARGIN_X + indent, state.y + 12);
    state.y += 15;
  }
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
 * Investment-summary-grade table: charcoal header with lime uppercase
 * labels, a charcoal body panel, hairline zinc row dividers and white
 * values. No tinted fills, so nothing can print olive.
 */
function drawTable(state: PdfState, rows: string[]) {
  const { doc } = state;
  if (rows.length < 2) return;
  const header = splitRow(rows[0]).map(stripInline);
  const body = rows.slice(2).map((r) => splitRow(r).map(stripInline));
  const colCount = header.length;
  const colW = CONTENT_W / colCount;
  const rowH = 22;

  ensureSpace(state, rowH * 2 + 8);

  // Header row — raised charcoal, lime labels.
  doc.setFillColor(...RAISED);
  doc.rect(MARGIN_X, state.y, CONTENT_W, rowH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ACCENT);
  header.forEach((h, i) => {
    doc.text(h.toUpperCase(), MARGIN_X + 8 + i * colW, state.y + 14);
  });
  // Divider under the header.
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_X, state.y + rowH, MARGIN_X + CONTENT_W, state.y + rowH);
  state.y += rowH;

  // Body rows — charcoal panel, white values, hairline dividers.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  body.forEach((cells, idx) => {
    ensureSpace(state, rowH);
    doc.setFillColor(...SURFACE);
    doc.rect(MARGIN_X, state.y, CONTENT_W, rowH, "F");
    doc.setTextColor(...TEXT);
    cells.forEach((c, i) => {
      doc.text(c, MARGIN_X + 8 + i * colW, state.y + 14);
    });
    if (idx < body.length - 1) {
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.line(MARGIN_X, state.y + rowH, MARGIN_X + CONTENT_W, state.y + rowH);
    }
    state.y += rowH;
  });

  state.y += 10;
}

function drawFooter(doc: jsPDF, pageNum: number, total: number) {
  const y = PAGE_H - 36;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_X, y - 14, PAGE_W - MARGIN_X, y - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Tweak & Build · New Jersey", MARGIN_X, y);
  doc.text(`Page ${pageNum} of ${total}`, PAGE_W / 2, y, { align: "center" });

  // Clickable lime site link, right-aligned.
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ACCENT);
  const label = "tweakandbuild.com";
  const linkX = PAGE_W - MARGIN_X - doc.getTextWidth(label);
  doc.textWithLink(label, linkX, y, { url: SITE_URL });
  doc.setFont("helvetica", "normal");
}

/** Convenience: build + return a base64 data string (without the prefix). */
export function buildProposalPdfBase64(opts: BuildProposalPdfOptions): string {
  const doc = buildProposalPdf(opts);
  const data = doc.output("datauristring");
  // datauristring is "data:application/pdf;filename=generated.pdf;base64,XXXX"
  const idx = data.indexOf("base64,");
  return idx >= 0 ? data.slice(idx + 7) : data;
}
