"use client";

import { Logo } from "@/components/brand/Logo";
import { renderMarkdown } from "@/lib/markdown";
import { sectionsToMarkdown } from "@/lib/proposals/sections";
import { SECTION_ORDER, SECTION_TITLES, type ProposalSections } from "@/lib/proposals/types";

interface ProposalPreviewProps {
  sections: ProposalSections;
  clientName: string;
  websiteUrl?: string;
  /** Dark = in-app preview. Light = the email/PDF version. */
  theme?: "dark" | "light";
}

export function ProposalPreview({
  sections,
  clientName,
  websiteUrl,
  theme = "dark",
}: ProposalPreviewProps) {
  const hasContent = SECTION_ORDER.some((k) => (sections[k] ?? "").trim().length > 0);

  if (theme === "light") {
    return <LightPreview sections={sections} clientName={clientName} websiteUrl={websiteUrl} />;
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

function LightPreview({
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
    <div className="rounded-lg border border-zinc-300 bg-white text-zinc-900 shadow-sm">
      <div className="border-b border-zinc-200 px-7 py-5">
        <Logo size={32} tone="light" />
      </div>
      <div className="px-7 pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Proposal
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
          {clientName || "Your Business"}
        </h1>
        {websiteUrl && <p className="text-sm text-zinc-500">{websiteUrl}</p>}
        <p className="mt-1 text-xs text-zinc-500">{date}</p>
      </div>
      <div className="px-7 pb-7 pt-2">
        {!hasContent ? (
          <p className="py-10 text-center text-sm text-zinc-400">
            The light email/PDF version of the proposal will appear here.
          </p>
        ) : (
          SECTION_ORDER.map((key) => {
            const body = sections[key]?.trim();
            if (!body) return null;
            return (
              <section key={key} className="mt-8 first:mt-4">
                <h2 className="text-lg font-bold tracking-tight text-zinc-900">
                  {SECTION_TITLES[key]}
                </h2>
                <div className="mt-1 mb-3 h-[3px] w-8 rounded bg-lime-500" />
                <div
                  className="proposal-light"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                />
              </section>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-7 py-4 text-xs">
        <span className="text-zinc-500">Tweak &amp; Build · New Jersey</span>
        <a
          href="https://tweakandbuild.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-lime-600 hover:underline"
        >
          tweakandbuild.com
        </a>
      </div>

      <style jsx>{`
        :global(.proposal-light h2) {
          color: #0f172a !important;
          border-bottom: none !important;
          padding: 0 !important;
          font-size: 1rem !important;
        }
        :global(.proposal-light h3) {
          color: #0f172a !important;
        }
        :global(.proposal-light p),
        :global(.proposal-light li) {
          color: #1e293b !important;
        }
        :global(.proposal-light strong) {
          color: #0f172a !important;
        }
        :global(.proposal-light a) {
          color: #65a30d !important;
        }
        :global(.proposal-light th) {
          background: #ecfccb !important;
          color: #0f172a !important;
          border-color: #e2e8f0 !important;
        }
        :global(.proposal-light td) {
          color: #0f172a !important;
          border-color: #e2e8f0 !important;
        }
        :global(.proposal-light table) {
          border-color: #e2e8f0 !important;
        }
        :global(.proposal-light code) {
          background: #f1f5f9 !important;
          color: #0f172a !important;
        }
      `}</style>
    </div>
  );
}
