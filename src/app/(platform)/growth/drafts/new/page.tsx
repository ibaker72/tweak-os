"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Sparkles, FileText, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GrowthOpportunity, GrowthBrief, GeneratedBrief, BriefOutline } from "@/types/growth";

type Step = "keyword" | "brief" | "generating_draft";

export default function NewDraftPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("keyword");
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [opportunities, setOpportunities] = useState<GrowthOpportunity[]>([]);

  // Brief state
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [brief, setBrief] = useState<GrowthBrief | null>(null);
  const [briefData, setBriefData] = useState<GeneratedBrief | null>(null);
  const [selectedTitle, setSelectedTitle] = useState(0);

  // Draft generation
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/growth/opportunities?status=planned&limit=50")
      .then((r) => r.json())
      .then((data) => setOpportunities(Array.isArray(data) ? data : data.opportunities ?? []))
      .catch(console.error);
  }, []);

  async function handleGenerateBrief() {
    const kw = keyword.trim() || opportunities.find((o) => o.id === selectedOpportunityId)?.keyword;
    if (!kw) return;

    try {
      setGeneratingBrief(true);
      setError(null);
      const res = await fetch("/api/growth/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: kw,
          opportunity_id: selectedOpportunityId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to generate brief");
      const data = await res.json();
      setBrief(data.brief ?? data);
      setStep("brief");
    } catch (err) {
      setError("Failed to generate brief. Please try again.");
      console.error(err);
    } finally {
      setGeneratingBrief(false);
    }
  }

  async function handleApproveBrief() {
    if (!brief) return;
    try {
      await fetch("/api/growth/briefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: brief.id, status: "approved" }),
      });
      await handleGenerateDraft();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleGenerateDraft() {
    if (!brief) return;
    try {
      setGeneratingDraft(true);
      setStep("generating_draft");
      setError(null);
      const res = await fetch("/api/growth/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_id: brief.id }),
      });
      if (!res.ok) throw new Error("Failed to generate draft");
      const data = await res.json();
      const draftId = data.draft?.id ?? data.id;
      router.push(`/growth/drafts/${draftId}`);
    } catch (err) {
      setError("Failed to generate draft. Please try again.");
      setStep("brief");
      console.error(err);
    } finally {
      setGeneratingDraft(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Create New Draft</h1>
        <p className="text-sm text-zinc-400 mt-1">Generate a brief, then create a draft</p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-sm">
        <span className={step === "keyword" ? "text-emerald-400 font-medium" : "text-zinc-500"}>
          1. Choose Topic
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-600" />
        <span className={step === "brief" ? "text-emerald-400 font-medium" : "text-zinc-500"}>
          2. Review Brief
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-600" />
        <span className={step === "generating_draft" ? "text-emerald-400 font-medium" : "text-zinc-500"}>
          3. Generate Draft
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Step 1: Keyword selection */}
      {step === "keyword" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-emerald-500" />
              Choose a Topic
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-zinc-400">Enter a keyword</label>
              <Input
                placeholder="e.g. custom website cost for small business"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setSelectedOpportunityId("");
                }}
                className="mt-1"
              />
            </div>

            {opportunities.length > 0 && (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-zinc-800" />
                  <span className="text-xs text-zinc-500">or select from planned opportunities</span>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>

                <Select
                  value={selectedOpportunityId}
                  onChange={(e) => {
                    setSelectedOpportunityId(e.target.value);
                    if (e.target.value) setKeyword("");
                  }}
                >
                  <option value="">Select an opportunity...</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.keyword} (score: {o.opportunity_score})
                    </option>
                  ))}
                </Select>
              </>
            )}

            <Button
              onClick={handleGenerateBrief}
              disabled={generatingBrief || (!keyword.trim() && !selectedOpportunityId)}
              className="w-full"
            >
              {generatingBrief ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Brief...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Brief
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Brief review */}
      {step === "brief" && brief && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Content Brief</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-zinc-400">Title</label>
                <p className="text-zinc-200 mt-1">{brief.title}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-zinc-400">Target Keyword</label>
                <p className="text-zinc-200 mt-1">{brief.target_keyword}</p>
              </div>

              {brief.target_url && (
                <div>
                  <label className="text-sm font-medium text-zinc-400">Target URL</label>
                  <p className="text-zinc-400 mt-1 font-mono text-sm">{brief.target_url}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-zinc-400">Target Word Count</label>
                <p className="text-zinc-200 mt-1">{brief.target_word_count} words</p>
              </div>

              {brief.outline && brief.outline.sections && (
                <div>
                  <label className="text-sm font-medium text-zinc-400">Outline</label>
                  <div className="mt-2 space-y-2">
                    {brief.outline.sections.map((section, i) => (
                      <div key={i} className={section.level === "h3" ? "pl-4" : ""}>
                        <p className="text-sm text-zinc-200 font-medium">
                          {section.level === "h2" ? "##" : "###"} {section.heading}
                        </p>
                        {section.key_points && (
                          <ul className="mt-1 space-y-0.5 pl-4">
                            {section.key_points.map((point, j) => (
                              <li key={j} className="text-xs text-zinc-400 list-disc">{point}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {brief.cta_strategy && (
                <div>
                  <label className="text-sm font-medium text-zinc-400">CTA Strategy</label>
                  <p className="text-zinc-300 mt-1 text-sm">{brief.cta_strategy}</p>
                </div>
              )}

              {brief.internal_links && brief.internal_links.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-zinc-400">Internal Links</label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {brief.internal_links.map((link, i) => (
                      <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 font-mono">
                        {link}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setStep("keyword")}>
              Back
            </Button>
            <Button onClick={handleApproveBrief} disabled={generatingDraft}>
              {generatingDraft ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Draft...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Approve & Generate Draft
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Generating draft */}
      {step === "generating_draft" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-12 w-12 animate-spin text-emerald-500 mb-4" />
            <h3 className="text-lg font-medium text-zinc-200">Generating your draft...</h3>
            <p className="text-sm text-zinc-400 mt-1">This may take 30-60 seconds</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
