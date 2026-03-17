"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DiscoveryResultsTable } from "@/components/dashboard/discovery-results-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { DiscoveryResult, DiscoverySource } from "@/lib/leads/types";
import { validateUrlList, type UrlValidationResult } from "@/lib/leads/discovery";
import {
  Compass,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Plus,
  Search,
  Globe,
  MapPin,
  XCircle,
  Sparkles,
} from "lucide-react";

type ManualRow = {
  business_name: string;
  city: string;
  state: string;
  website: string;
};

export default function DiscoverPage() {
  const router = useRouter();
  const [source, setSource] = useState<DiscoverySource>("google_places");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [keyword, setKeyword] = useState("");
  const [urls, setUrls] = useState("");
  const [radius, setRadius] = useState("10");

  const [manualRows, setManualRows] = useState<ManualRow[]>([
    { business_name: "", city: "", state: "", website: "" },
  ]);

  const [urlWarnings, setUrlWarnings] = useState<UrlValidationResult[]>([]);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [saveSearchName, setSaveSearchName] = useState("");

  function handleUrlsChange(value: string) {
    setUrls(value);
    if (value.trim()) {
      const results = validateUrlList(value);
      setUrlWarnings(results.filter((r) => !r.valid));
    } else {
      setUrlWarnings([]);
    }
  }

  async function handleDiscover() {
    setRunning(true);
    setError(null);
    setSuccessMsg(null);
    setResults([]);

    if (source === "url_list") {
      const validated = validateUrlList(urls);
      const validCount = validated.filter((v) => v.valid).length;
      if (validated.length > 0 && validCount === 0) {
        setError("All URLs were rejected. Please paste actual business website URLs, not directories or platforms.");
        setRunning(false);
        return;
      }
    }

    try {
      if (source === "manual") {
        const validRows = manualRows.filter(
          (r) => r.business_name.trim().length > 0
        );
        if (validRows.length === 0) {
          setError("Add at least one business to import.");
          setRunning(false);
          return;
        }

        const importRes = await fetch("/api/imports", {
          method: "POST",
          body: createManualCsvBlob(validRows),
        });
        const importData = await importRes.json();
        if (!importRes.ok) {
          setError(importData.error || "Import failed");
        } else {
          setSuccessMsg(
            `Imported ${importData.imported_rows} of ${importData.total_rows} leads directly.`
          );
          setManualRows([
            { business_name: "", city: "", state: "", website: "" },
          ]);
        }
      } else {
        const res = await fetch("/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            niche,
            city,
            state,
            keyword,
            urls,
            radius: source === "google_places" ? parseInt(radius) : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Discovery failed");
        } else {
          setResults(data.results ?? []);
          setSuccessMsg(`Found ${data.total_found} businesses.`);
        }
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  async function handleImportSelected(ids: string[]) {
    setImportMsg(null);
    try {
      const res = await fetch("/api/discover", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
      } else {
        setImportMsg(
          `Imported ${data.imported} leads. ${data.skipped > 0 ? `${data.skipped} skipped (duplicates).` : ""}`
        );
      }
    } catch {
      setError("Network error during import.");
    }
  }

  async function handleSaveSearch() {
    if (!saveSearchName.trim()) return;
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveSearchName,
          query: keyword || niche,
          location: [city, state].filter(Boolean).join(", "),
          radius: parseInt(radius),
          industry: niche,
        }),
      });
      if (res.ok) {
        setSaveSearchName("");
        setSuccessMsg("Search saved!");
      }
    } catch {
      setError("Failed to save search.");
    }
  }

  function addManualRow() {
    setManualRows((prev) => [
      ...prev,
      { business_name: "", city: "", state: "", website: "" },
    ]);
  }

  function updateManualRow(index: number, field: keyof ManualRow, value: string) {
    setManualRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function removeManualRow(index: number) {
    setManualRows((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="Discover Leads"
        description="Search for businesses using Google Places, Google Search, or paste URLs"
      />

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Compass className="h-5 w-5 text-emerald-500" />
              Discovery Source
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-zinc-400">Source</label>
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as DiscoverySource)}
                className="mt-1"
              >
                <option value="google_places">Google Places (Recommended)</option>
                <option value="google_search">Google Custom Search</option>
                <option value="url_list">URL List (paste websites)</option>
                <option value="manual">Manual Entry</option>
              </Select>
            </div>

            {source === "google_places" && (
              <>
                <div>
                  <label className="text-sm font-medium text-zinc-400">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    Industry / Category
                  </label>
                  <Input
                    placeholder="e.g. restaurant, dentist, plumber"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-zinc-400">City</label>
                    <Input placeholder="Paterson" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400">State</label>
                    <Input placeholder="NJ" value={state} onChange={(e) => setState(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400">Radius (miles)</label>
                  <Select value={radius} onChange={(e) => setRadius(e.target.value)} className="mt-1">
                    <option value="5">5 miles</option>
                    <option value="10">10 miles</option>
                    <option value="25">25 miles</option>
                    <option value="50">50 miles</option>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400">Keyword (optional)</label>
                  <Input placeholder="e.g. best, top rated" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="mt-1" />
                </div>
              </>
            )}

            {source === "google_search" && (
              <>
                <div>
                  <label className="text-sm font-medium text-zinc-400">
                    <Search className="mr-1 inline h-3 w-3" />
                    Industry
                  </label>
                  <Input placeholder="e.g. web design agency" value={niche} onChange={(e) => setNiche(e.target.value)} className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-zinc-400">City</label>
                    <Input placeholder="Newark" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400">State</label>
                    <Input placeholder="NJ" value={state} onChange={(e) => setState(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400">Keyword</label>
                  <Input placeholder="Optional additional keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="mt-1" />
                </div>
                <div className="rounded-lg bg-zinc-800/50 p-3">
                  <p className="text-xs text-zinc-400">Google Custom Search: 100 free queries/day.</p>
                </div>
              </>
            )}

            {source === "url_list" && (
              <>
                <div>
                  <label className="text-sm font-medium text-zinc-400">Niche</label>
                  <Input placeholder="e.g. plumber, dentist" value={niche} onChange={(e) => setNiche(e.target.value)} className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-zinc-400">City</label>
                    <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400">State</label>
                    <Input placeholder="ST" value={state} onChange={(e) => setState(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-400">
                    <Globe className="mr-1 inline h-3 w-3" />
                    Business Website URLs <span className="text-zinc-600">(one per line)</span>
                  </label>
                  <Textarea
                    rows={6}
                    placeholder={`example-plumber.com\nwww.dentist-office.com\nhttps://local-restaurant.com`}
                    value={urls}
                    onChange={(e) => handleUrlsChange(e.target.value)}
                    className={`mt-1 font-mono text-xs ${urlWarnings.length > 0 ? "border-amber-700" : ""}`}
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Paste actual business websites — not directories like Yelp, Google, or social media profiles.
                  </p>
                </div>

                {urlWarnings.length > 0 && (
                  <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3" />
                      {urlWarnings.length} URL{urlWarnings.length !== 1 ? "s" : ""} will be skipped:
                    </p>
                    {urlWarnings.slice(0, 5).map((w, i) => (
                      <p key={i} className="text-xs text-amber-500/80 flex items-center gap-1.5 pl-4">
                        <XCircle className="h-3 w-3 shrink-0" />
                        <span className="font-mono truncate">{w.url}</span>
                        <span className="text-amber-600 shrink-0">— {w.reason}</span>
                      </p>
                    ))}
                    {urlWarnings.length > 5 && (
                      <p className="text-xs text-amber-600 pl-4">
                        ...and {urlWarnings.length - 5} more
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {source !== "manual" && (
              <>
                <Button onClick={handleDiscover} disabled={running} className="w-full">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {running ? "Searching..." : "Search"}
                </Button>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Save search as..."
                    value={saveSearchName}
                    onChange={(e) => setSaveSearchName(e.target.value)}
                    className="text-xs"
                  />
                  <Button variant="outline" size="sm" onClick={handleSaveSearch} disabled={!saveSearchName.trim()}>
                    Save
                  </Button>
                </div>
              </>
            )}

            {source === "manual" && (
              <Button onClick={handleDiscover} disabled={running} className="w-full">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {running ? "Importing..." : "Import Manual Entries"}
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-red-900 bg-red-950/30 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-900 bg-emerald-950/30 px-4 py-3">
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-sm text-emerald-400">{successMsg}</p>
            </div>
          )}

          {importMsg && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-blue-900 bg-blue-950/30 px-4 py-3">
                <CheckCircle className="h-4 w-4 shrink-0 text-blue-500" />
                <p className="text-sm text-blue-400">{importMsg}</p>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-emerald-900 bg-emerald-950/20 px-4 py-3">
                <Sparkles className="h-5 w-5 shrink-0 text-emerald-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-300">
                    Enrich imported leads to detect tech stacks, scores, and outreach angles
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push("/leads?enrichment_status=pending")}
                  className="shrink-0"
                >
                  Enrich Now
                </Button>
              </div>
            </div>
          )}

          {source === "manual" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Manual Entries</CardTitle>
                  <Badge variant="secondary">
                    {manualRows.length} row{manualRows.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {manualRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 items-center rounded-lg border border-zinc-800 p-3 sm:grid-cols-12 sm:border-0 sm:p-0">
                    <Input className="col-span-2 sm:col-span-4" placeholder="Business name *" value={row.business_name} onChange={(e) => updateManualRow(i, "business_name", e.target.value)} />
                    <Input className="col-span-1 sm:col-span-2" placeholder="City" value={row.city} onChange={(e) => updateManualRow(i, "city", e.target.value)} />
                    <Input className="col-span-1 sm:col-span-1" placeholder="ST" value={row.state} onChange={(e) => updateManualRow(i, "state", e.target.value)} />
                    <Input className="col-span-2 sm:col-span-4" placeholder="website.com" value={row.website} onChange={(e) => updateManualRow(i, "website", e.target.value)} />
                    <button onClick={() => removeManualRow(i)} className="col-span-2 text-center text-zinc-500 transition-colors hover:text-red-400 sm:col-span-1" type="button">&times;</button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addManualRow}>
                  <Plus className="h-4 w-4" />
                  Add Row
                </Button>
              </CardContent>
            </Card>
          )}

          {source !== "manual" && (
            <DiscoveryResultsTable results={results} onImport={handleImportSelected} />
          )}
        </div>
      </div>
    </div>
  );
}

function createManualCsvBlob(rows: ManualRow[]): FormData {
  const header = "business_name,city,state,website,source,niche";
  const csvRows = rows.map(
    (r) => `"${esc(r.business_name)}","${esc(r.city)}","${esc(r.state)}","${esc(r.website)}","manual",""`
  );
  const csv = [header, ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const file = new File([blob], "manual-discovery.csv", { type: "text/csv" });
  const formData = new FormData();
  formData.append("file", file);
  return formData;
}

function esc(val: string): string {
  return val.replace(/"/g, '""');
}
