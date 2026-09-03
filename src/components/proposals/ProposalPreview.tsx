"use client";

import { Logo } from "@/components/brand/Logo";
import { renderMarkdown } from "@/lib/markdown";
import { sectionsToMarkdown } from "@/lib/proposals/sections";
import { PROPOSAL_THEME as T } from "@/lib/proposals/theme";
import { SECTION_ORDER, SECTION_TITLES, type ProposalSections } from "@/lib/proposals/types";

interface ProposalPreviewProps {
  sections: ProposalSections;
  clientName: string;
  websiteUrl?: string;
  /** "app" = in-app reading view. "email" = exactly what the client receives. */
  theme?: "app" | "email";
}

export function ProposalPreview({
  sections,
  clientName,
  websiteUrl,
  theme = "app",
}: ProposalPreviewProps) {
  const hasContent = SECTION_ORDER.some((k) => (sections[k] ?? "").trim().length > 0);

  if (theme === "email") {
    return <EmailPreview sections={sections} clientName={clientName} websiteUrl={websiteUrl} />;
  }

  if (!hasContent) {
    return (
      <div className="min-h-[500px] rounded-lg border border-zinc-800 bg-zinc-950/60 p-5">
        <p className="py-12 text-center text-sm text-zinc-500">
          Edit the sections on the left — the preview will appear here as you type.
        </p>
      </div>
    );
  }

  return (
    <div
      id="proposal-preview"
      className="min-h-[500px] rounded-lg border border-zinc-800 bg-zinc-950/60 p-5"
    >
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-zinc-800 pb-3">
        <Logo size={32} />
        <p className="text-sm text-zinc-400">
          Proposal {clientName ? `for ${clientName}` : ""}
        </p>
      </div>
      <div
        className="proposal-markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(sectionsToMarkdown(sections)) }}
      />
    </div>
  );
}

/**
 * A faithful on-screen rendition of the email/PDF the client receives —
 * near-black canvas, charcoal card, acid-lime accents. Colors come from
 * PROPOSAL_THEME so this preview can never drift from the real renderer.
 */
function EmailPreview({
  sections,
  clientName,
  websiteUrl,
}: {
  sections: ProposalSections;
  clientName: string;
  websiteUrl?: string;
}) {
  const hasContent = SECTION_ORDER.some((k) => (sections[k] ?? "").trim().length > 0);
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="rounded-xl p-4" style={{ background: T.background }}>
      <div
        className="overflow-hidden rounded-xl border"
        style={{ background: T.surface, borderColor: T.border }}
      >
        <div className="px-7 py-5">
          <Logo size={28} />
          <div
            className="mt-4 h-[3px] w-11 rounded-full"
            style={{ background: T.accent }}
          />
        </div>

        <div className="px-7 pt-2">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: T.textMuted }}
          >
            Proposal
          </p>
          <h1
            className="mt-1.5 text-2xl font-bold tracking-tight"
            style={{ color: T.text }}
          >
            {clientName || "Your Business"}
          </h1>
          {websiteUrl && (
            <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
              {websiteUrl}
            </p>
          )}
          <p className="mt-1 text-xs" style={{ color: T.textMuted }}>
            {date}
          </p>
        </div>

        <div className="px-7 pb-7 pt-2">
          {!hasContent ? (
            <p className="py-10 text-center text-sm" style={{ color: T.textSubtle }}>
              The email/PDF version of the proposal will appear here.
            </p>
          ) : (
            SECTION_ORDER.map((key) => {
              const body = sections[key]?.trim();
              if (!body) return null;
              return (
                <section key={key} className="mt-8 first:mt-4">
                  <h2
                    className="text-lg font-bold tracking-tight"
                    style={{ color: T.text }}
                  >
                    {SECTION_TITLES[key]}
                  </h2>
                  <div
                    className="mb-3 mt-2 h-[3px] w-8 rounded-full"
                    style={{ background: T.accent }}
                  />
                  <div
                    className="proposal-email"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                  />
                </section>
              );
            })
          )}
        </div>

        <div
          className="flex items-center justify-between gap-3 border-t px-7 py-4 text-xs"
          style={{ background: T.surfaceRaised, borderColor: T.border }}
        >
          <span style={{ color: T.textMuted }}>Sent via Tweak &amp; Build OS</span>
          <a
            href="https://tweakandbuild.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-3.5 py-2 text-sm font-semibold"
            style={{ background: T.accentSolid, color: T.onAccent }}
          >
            tweakandbuild.com
          </a>
        </div>
      </div>

      <style jsx>{`
        :global(.proposal-email h2),
        :global(.proposal-email h3) {
          color: ${T.text} !important;
          border-bottom: none !important;
          padding: 0 !important;
          font-size: 1rem !important;
        }
        :global(.proposal-email p),
        :global(.proposal-email li) {
          color: ${T.textBody} !important;
        }
        :global(.proposal-email strong) {
          color: ${T.text} !important;
        }
        :global(.proposal-email a) {
          color: ${T.accent} !important;
          text-decoration: underline !important;
        }
        :global(.proposal-email table) {
          border-color: ${T.border} !important;
        }
        :global(.proposal-email th) {
          background: ${T.surfaceRaised} !important;
          color: ${T.accent} !important;
          border-color: ${T.border} !important;
          text-transform: uppercase !important;
          letter-spacing: 0.08em !important;
        }
        :global(.proposal-email td) {
          color: ${T.text} !important;
          border-color: ${T.border} !important;
        }
        :global(.proposal-email code) {
          background: ${T.surfaceRaised} !important;
          color: ${T.accent} !important;
        }
      `}</style>
    </div>
  );
}
