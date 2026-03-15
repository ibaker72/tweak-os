"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2, ArrowLeft, Save, Eye, Edit, Check, X, ExternalLink, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DRAFT_STATUSES } from "@/lib/shared/constants";
import type { GrowthDraft } from "@/types/growth";
import Link from "next/link";

export default function DraftEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [draft, setDraft] = useState<GrowthDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Editable fields
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [showPublishForm, setShowPublishForm] = useState(false);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchDraft();
  }, [id]);

  async function fetchDraft() {
    try {
      setLoading(true);
      const res = await fetch(`/api/growth/drafts/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      const d = data.draft ?? data;
      setDraft(d);
      setTitle(d.title ?? "");
      setContent(d.content ?? "");
      setMetaTitle(d.meta_title ?? "");
      setMetaDescription(d.meta_description ?? "");
      setSlug(d.slug ?? "");
      setStatus(d.status ?? "draft");
      setScheduledFor(d.scheduled_for ? d.scheduled_for.split("T")[0] : "");
      setPublishedUrl(d.published_url ?? "");
    } catch {
      router.push("/growth/drafts");
    } finally {
      setLoading(false);
    }
  }

  const debouncedSave = useCallback(
    (updates: Record<string, unknown>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveDraft(updates), 1000);
    },
    [id]
  );

  async function saveDraft(updates: Record<string, unknown>) {
    try {
      setSaving(true);
      const res = await fetch(`/api/growth/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.draft ?? data;
        setDraft(updated);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleContentChange(val: string) {
    setContent(val);
    debouncedSave({ content: val });
  }

  function handleTitleChange(val: string) {
    setTitle(val);
    debouncedSave({ title: val });
  }

  async function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    await saveDraft({ status: newStatus });
  }

  async function handlePublish() {
    if (!publishedUrl.trim()) return;
    await saveDraft({
      status: "published",
      published_url: publishedUrl,
      published_at: new Date().toISOString(),
    });
    setStatus("published");
    setShowPublishForm(false);
  }

  async function handleSaveMetadata() {
    await saveDraft({
      meta_title: metaTitle,
      meta_description: metaDescription,
      slug,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
    });
  }

  function renderMarkdown(md: string): string {
    return md
      .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold text-zinc-200 mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gm, '<h2 class="text-xl font-bold text-zinc-100 mt-6 mb-3">$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-zinc-100">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-emerald-400 hover:underline" target="_blank">$1</a>')
      .replace(/^- (.*$)/gm, '<li class="ml-4 text-zinc-300">$1</li>')
      .replace(/^(?!<[h|l|s])(.*$)/gm, (match) => {
        if (match.trim() === "") return '<br/>';
        if (match.startsWith("<")) return match;
        return `<p class="text-zinc-300 leading-relaxed mb-3">${match}</p>`;
      });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!draft) return null;

  const seoFeedback = draft.seo_feedback;
  const seoChecks = [
    { label: "Title includes keyword", pass: draft.meta_title ? true : false },
    { label: "Meta description set", pass: !!draft.meta_description },
    { label: "H2 headings present", pass: content.includes("## ") },
    { label: "Internal links included", pass: content.toLowerCase().includes("tweakandbuild.com") },
    { label: "CTA present", pass: content.toLowerCase().includes("contact") || content.toLowerCase().includes("get in touch") },
    { label: "Keyword density OK", pass: draft.seo_score >= 50 },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/growth/drafts" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Drafts
        </Link>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-zinc-500 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving...</span>}
          <Button variant="outline" size="sm" onClick={() => setPreviewMode(!previewMode)}>
            {previewMode ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {previewMode ? "Edit" : "Preview"}
          </Button>
          <Button size="sm" onClick={() => saveDraft({ title, content, meta_title: metaTitle, meta_description: metaDescription, slug })}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editor (left, 2/3) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full bg-transparent text-2xl font-bold text-zinc-50 placeholder-zinc-600 outline-none border-none"
            placeholder="Draft title..."
          />

          {/* Editor / Preview */}
          {previewMode ? (
            <div
              className="min-h-[500px] rounded-xl border border-zinc-800 bg-zinc-900 p-6 prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : (
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              className="min-h-[500px] w-full rounded-xl border border-zinc-800 bg-zinc-900 p-6 font-mono text-sm text-zinc-200 placeholder-zinc-600 outline-none resize-y"
              placeholder="Start writing your content in markdown..."
            />
          )}
        </div>

        {/* Sidebar (right, 1/3) */}
        <div className="space-y-4">
          {/* Brief summary */}
          {draft.brief && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-400">Brief</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-200">{draft.brief.target_keyword}</p>
                <p className="text-xs text-zinc-500 mt-1">{draft.brief.target_word_count} target words</p>
              </CardContent>
            </Card>
          )}

          {/* SEO Score */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-400">SEO Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <span className={cn(
                  "text-4xl font-bold",
                  draft.seo_score >= 70 ? "text-emerald-400" : draft.seo_score >= 40 ? "text-amber-400" : "text-red-400"
                )}>
                  {draft.seo_score}
                </span>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className={cn(
                        "h-2 rounded-full transition-all",
                        draft.seo_score >= 70 ? "bg-emerald-500" : draft.seo_score >= 40 ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${draft.seo_score}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* SEO Checklist */}
              <div className="mt-4 space-y-2">
                {seoChecks.map((check, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {check.pass ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <X className="h-3 w-3 text-red-400" />
                    )}
                    <span className={cn("text-xs", check.pass ? "text-zinc-400" : "text-zinc-500")}>
                      {check.label}
                    </span>
                  </div>
                ))}
              </div>

              {seoFeedback && (seoFeedback.issues.length > 0 || seoFeedback.suggestions.length > 0) && (
                <div className="mt-3 pt-3 border-t border-zinc-800 space-y-1">
                  {seoFeedback.issues.map((issue, i) => (
                    <p key={`i-${i}`} className="text-xs text-red-400">• {issue}</p>
                  ))}
                  {seoFeedback.suggestions.map((s, i) => (
                    <p key={`s-${i}`} className="text-xs text-amber-400">• {s}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-zinc-500">Words</p>
                  <p className="text-lg font-bold text-zinc-200">{draft.word_count}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Readability</p>
                  <p className="text-lg font-bold text-zinc-200">{draft.readability_score ?? "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-400">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500">Meta Title</label>
                <Input
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  onBlur={handleSaveMetadata}
                  className="mt-1 text-xs"
                  placeholder="SEO title..."
                />
                <p className="text-[10px] text-zinc-600 mt-0.5">{metaTitle.length}/60</p>
              </div>
              <div>
                <label className="text-xs text-zinc-500">Meta Description</label>
                <Textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  onBlur={handleSaveMetadata}
                  className="mt-1 text-xs"
                  rows={3}
                  placeholder="SEO description..."
                />
                <p className="text-[10px] text-zinc-600 mt-0.5">{metaDescription.length}/160</p>
              </div>
              <div>
                <label className="text-xs text-zinc-500">URL Slug</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  onBlur={handleSaveMetadata}
                  className="mt-1 text-xs font-mono"
                  placeholder="url-slug"
                />
              </div>
            </CardContent>
          </Card>

          {/* Status & Publishing */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-400">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500">Status</label>
                <Select
                  value={status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  className="mt-1"
                >
                  {DRAFT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-xs text-zinc-500">Scheduled For</label>
                <Input
                  type="date"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  onBlur={handleSaveMetadata}
                  className="mt-1 text-xs"
                />
              </div>

              {(status === "approved" || status === "scheduled") && !showPublishForm && (
                <Button size="sm" className="w-full" onClick={() => setShowPublishForm(true)}>
                  <Globe className="h-4 w-4" />
                  Mark as Published
                </Button>
              )}

              {showPublishForm && (
                <div className="space-y-2 p-3 rounded-lg bg-zinc-800/50">
                  <label className="text-xs text-zinc-400">Published URL</label>
                  <Input
                    value={publishedUrl}
                    onChange={(e) => setPublishedUrl(e.target.value)}
                    placeholder="https://tweakandbuild.com/blog/..."
                    className="text-xs font-mono"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handlePublish} disabled={!publishedUrl.trim()}>
                      <Check className="h-3 w-3" />
                      Publish
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowPublishForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {status === "published" && draft.published_url && (
                <a
                  href={draft.published_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
                >
                  <ExternalLink className="h-3 w-3" />
                  View live article
                </a>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
