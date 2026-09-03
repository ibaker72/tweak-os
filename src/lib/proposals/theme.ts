/**
 * ============================================================
 * Tweak & Build proposal brand theme — single source of truth
 * ============================================================
 *
 * Every proposal surface (email HTML, PDF, in-app "Email/PDF" preview)
 * reads its colors from here. Nothing below is invented: each value is
 * lifted from a brand token that already ships in the app.
 *
 *   #09090b  src/app/globals.css  --background            (zinc-950)
 *   #fafafa  src/app/globals.css  --foreground            (zinc-50)
 *   #d1f526  src/app/globals.css  --accent                (acid lime)
 *   #b8dc1e  src/app/globals.css  --accent-hover
 *   #18181b  src/app/globals.css  scrollbar track         (zinc-900)
 *   #3f3f46  src/app/globals.css  scrollbar thumb         (zinc-700)
 *   #a3e635  src/components/brand/Logo.tsx BrandMark fill (lime-400)
 *   #0a0a0a  src/components/brand/Logo.tsx chevron stroke
 *   #27272a  src/components/ui/card.tsx    border-zinc-800
 *   #a1a1aa  text-zinc-400 — the app's standard secondary text
 *   #d4d4d8  text-zinc-300 — the app's standard body text
 *
 * Deliberately absent: the olive lime-600 (#65a30d), lime-500 (#84cc16),
 * pale lime washes (#ecfccb / #f7fee7) and warm off-whites (#f7f8f5 /
 * #fafaf7) the proposal used to ship with. None of those are Tweak &
 * Build brand colors.
 */

export const PROPOSAL_THEME = {
  /** Page / outer canvas — near-black. globals.css --background. */
  background: "#09090b",
  /** Card + section surface — the app Card (bg-zinc-900/50) over --background. */
  surface: "#111113",
  /** Raised surface: table headers, pills, footer band. zinc-900. */
  surfaceRaised: "#18181b",

  /** Primary accent — globals.css --accent. Rules, links, table headers. */
  accent: "#d1f526",
  /** Accent pressed/hover — globals.css --accent-hover. */
  accentHover: "#b8dc1e",
  /** Logo mark fill + CTA button fill — lime-400, matches the site's Button. */
  accentSolid: "#a3e635",
  /** Text/iconography sitting on top of a solid accent fill. */
  onAccent: "#0a0a0a",
  /** Subtle accent wash — --accent-muted (10%) flattened over `surface`. */
  accentSoft: "#1a1f12",
  /** Subtle accent hairline — --accent-border (20%) flattened over `surface`. */
  accentBorder: "#2e3a17",

  /** Headings and table values — globals.css --foreground. */
  text: "#fafafa",
  /** Body copy — text-zinc-300. */
  textBody: "#d4d4d8",
  /** Secondary copy: dates, URLs, footer, eyebrows — text-zinc-400. */
  textMuted: "#a1a1aa",
  /** Tertiary copy: fine print — text-zinc-500. */
  textSubtle: "#71717a",

  /** Dividers, card outlines — zinc-800 (the app Card border). */
  border: "#27272a",
  /** Stronger outline: pills, hover states — zinc-700. */
  borderStrong: "#3f3f46",
} as const;

export type ProposalTheme = typeof PROPOSAL_THEME;

/** The brand font stack used across the app (globals.css --font-sans). */
// NOTE: single quotes around "Segoe UI" are deliberate. This string is
// interpolated into HTML style="..." attributes, so a double quote here
// would terminate the attribute and silently drop every later declaration.
export const PROPOSAL_FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ------------------------------------------------------------------
// jsPDF helpers — same palette, expressed as RGB tuples.
// ------------------------------------------------------------------

export type Rgb = [number, number, number];

/** "#09090b" -> [9, 9, 11]. Used to feed the theme straight into jsPDF. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** The proposal palette as jsPDF-ready RGB tuples. */
export const PDF_THEME = {
  background: hexToRgb(PROPOSAL_THEME.background),
  surface: hexToRgb(PROPOSAL_THEME.surface),
  surfaceRaised: hexToRgb(PROPOSAL_THEME.surfaceRaised),
  accent: hexToRgb(PROPOSAL_THEME.accent),
  accentSolid: hexToRgb(PROPOSAL_THEME.accentSolid),
  onAccent: hexToRgb(PROPOSAL_THEME.onAccent),
  text: hexToRgb(PROPOSAL_THEME.text),
  textBody: hexToRgb(PROPOSAL_THEME.textBody),
  textMuted: hexToRgb(PROPOSAL_THEME.textMuted),
  border: hexToRgb(PROPOSAL_THEME.border),
  borderStrong: hexToRgb(PROPOSAL_THEME.borderStrong),
} satisfies Record<string, Rgb>;

// ------------------------------------------------------------------
// Shared email/PDF-safe style fragments.
// ------------------------------------------------------------------

const T = PROPOSAL_THEME;

/** Inline style for a body paragraph / list. */
export const bodyStyle = `color:${T.textBody};font-size:15px;line-height:1.7;`;

/** Inline style for an inline text link — accent lime, underlined. */
export const linkStyle = `color:${T.accent};text-decoration:underline;`;

/** Table styles. Dark header + lime label, hairline row dividers, white values. */
export const tableStyles = {
  wrapper: `width:100%;table-layout:auto;border-collapse:separate;border-spacing:0;margin:14px 0 22px 0;border:1px solid ${T.border};border-radius:10px;overflow:hidden;`,
  th: `text-align:left;padding:11px 14px;background:${T.surfaceRaised};color:${T.accent};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid ${T.border};`,
  td: `padding:12px 14px;font-size:15px;line-height:1.5;color:${T.text};border-bottom:1px solid ${T.border};`,
  tdLast: `padding:12px 14px;font-size:15px;line-height:1.5;color:${T.text};`,
} as const;

/**
 * A CTA button matching the site's primary Button
 * (`bg-lime-400 text-zinc-950 rounded-md`), built from a bulletproof
 * table so Outlook renders the fill.
 */
export function ctaButtonHtml(opts: { href: string; label: string }): string {
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:separate;">
  <tr>
    <td align="center" bgcolor="${T.accentSolid}" style="background:${T.accentSolid};border-radius:6px;">
      <a href="${opts.href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 20px;font-family:${PROPOSAL_FONT};font-size:14px;font-weight:600;line-height:1;color:${T.onAccent};text-decoration:none;border-radius:6px;white-space:nowrap;">${opts.label}</a>
    </td>
  </tr>
</table>`;
}

/** A short lime accent rule — the brand's section marker. */
export function accentRuleHtml(width = 44, marginTop = 14): string {
  return `<div style="height:3px;width:${width}px;background:${T.accent};border-radius:2px;margin:${marginTop}px 0 0 0;line-height:3px;font-size:0;">&nbsp;</div>`;
}
