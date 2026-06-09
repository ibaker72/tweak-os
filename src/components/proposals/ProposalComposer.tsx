"use client";

import { Textarea } from "@/components/ui/textarea";
import { SECTION_ORDER, SECTION_TITLES, type ProposalSections } from "@/lib/proposals/types";

interface ProposalComposerProps {
  sections: ProposalSections;
  onChange: (next: ProposalSections) => void;
  disabled?: boolean;
}

const ROWS_BY_SECTION: Partial<Record<keyof ProposalSections, number>> = {
  executive_summary: 4,
  what_we_found: 6,
  our_recommendation: 6,
  investment_summary: 8,
  what_happens_next: 5,
  about: 4,
  custom_notes: 4,
};

const HINTS: Partial<Record<keyof ProposalSections, string>> = {
  executive_summary: "2-3 sentences. Use soft language — no exact lead counts.",
  what_we_found: "Bulleted list of audit findings or common opportunities.",
  our_recommendation: "Which services and why, tied to the findings above.",
  investment_summary: "Markdown table: | Service | Price | Billing |",
  what_happens_next: "Numbered steps: Discovery → Build → Launch.",
  about: "Short bio paragraph about Tweak & Build.",
  custom_notes: "Optional. Specific notes for this proposal only.",
};

export function ProposalComposer({
  sections,
  onChange,
  disabled = false,
}: ProposalComposerProps) {
  function update<K extends keyof ProposalSections>(key: K, value: string) {
    onChange({ ...sections, [key]: value });
  }
  return (
    <div className="space-y-5">
      {SECTION_ORDER.map((key) => (
        <div key={key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              {SECTION_TITLES[key]}
            </label>
            <span className="text-[10px] text-zinc-600">{HINTS[key]}</span>
          </div>
          <Textarea
            value={sections[key] ?? ""}
            onChange={(e) => update(key, e.target.value)}
            disabled={disabled}
            rows={ROWS_BY_SECTION[key] ?? 4}
            className="font-mono text-[13px] leading-relaxed"
          />
        </div>
      ))}
    </div>
  );
}
