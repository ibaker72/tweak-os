"use client";

import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DiscoveryResultsTable } from "@/components/dashboard/discovery-results-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { DiscoveryResult, DiscoverySource } from "@/lib/leads/types";
import {
  Compass,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Plus,
} from "lucide-react";

type ManualRow = {
  business_name: string;
  city: string;
  state: string;
  website: string;
};

export default function DiscoverPage() {
  // Form state
  const [source, setSource] = useState<DiscoverySource>("url_list");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [keyword, setKeyword] = useState("");
  const [urls, setUrls] = useState("");

  // Manual entry state
  const [manualRows, setManualRows] = useState<ManualRow[]>([
    { business_name: "", city: "", state: "", website: "" },
  ]);

  // Discovery state
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function handleDiscover() {
    setRunning(true);
    setError(null);
    setSuccessMsg(null);
    setResults([]);

    try {
      if (source === "manual") {
        // For manual, create results from the form rows directly
        const validRows = manualRows.filter(
          (r) => r.business_name.trim().length > 0
        );
        if (validRows.length === 0) {
          setError("Add at least one business to import.");
          setRunning(false);
          return;
        }

        // Create via API with manual source — send as url_list with no URLs
        // Then manually insert. For simplicity, send manual rows as JSON.
        const res = await fetch("/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "manual",
            niche,
            city,
            state,
            keyword,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Discovery failed");
          setRunning(false);
          return;
        }

        // For manual mode, we need to insert the rows as discovery results
        // via a separate approach. Let's use the import directly.
        // Instead, let's use the discover API with url_list but empty URLs
        // and then handle manual rows client-side by importing them directly.

        // Actually, let's handle manual entry by calling the import API
        // to create leads directly — this reuses the existing flow cleanly.
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
          body: JSON.stringify({ source, niche, city, state, keyword, urls }),
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

  function addManualRow() {
    setManualRows((prev) => [
      ...prev,
      { business_name: "", city: "", state: "", website: "" },
    ]);
  }

  function updateManualRow(
    index: number,
    field: keyof ManualRow,
    value: string
  ) {
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
        description="Find seed businesses from approved sources, then import into your pipeline"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Discovery Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Compass className="h-5 w-5 text-emerald-500" />
              Discovery Source
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Source Selection */}
            <div>
              <label className="text-sm font-medium text-zinc-400">
                Source
              </label>
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as DiscoverySource)}
                className="mt-1"
              >
                <option value="url_list">URL List (paste websites)</option>
                <option value="yelp">Yelp Fusion API</option>
                <option value="manual">Manual Entry</option>
              </Select>
            </div>

            {/* Shared fields */}
            <div>
              <label className="text-sm font-medium text-zinc-400">Niche</label>
              <Input
                placeholder="e.g. plumber, dentist, restaurant"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-zinc-400">
                  City
                </label>
                <Input
                  placeholder="Austin"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-400">
                  State
                </label>
                <Input
                  placeholder="TX"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-400">
                Keyword
              </label>
              <Input
                placeholder="Optional search keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* URL List input */}
            {source === "url_list" && (
              <div>
                <label className="text-sm font-medium text-zinc-400">
                  Website URLs{" "}
                  <span className="text-zinc-600">(one per line)</span>
                </label>
                <Textarea
                  rows={6}
                  placeholder={`example-plumber.com\nwww.dentist-office.com\nhttps://local-restaurant.com`}
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                  className="mt-1 font-mono text-xs"
                />
              </div>
            )}

            {/* Yelp note */}
            {source === "yelp" && (
              <div className="rounded-lg bg-zinc-800/50 p-3">
                <p className="text-xs text-zinc-400">
                  Requires <code className="text-zinc-300">YELP_API_KEY</code>{" "}
                  environment variable. City or state is required.
                </p>
              </div>
            )}

            {/* Run button */}
            {source !== "manual" && (
              <Button
                onClick={handleDiscover}
                disabled={running}
                className="w-full"
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Compass className="h-4 w-4" />
                )}
                {running ? "Discovering..." : "Run Discovery"}
              </Button>
            )}

            {source === "manual" && (
              <Button
                onClick={handleDiscover}
                disabled={running}
                className="w-full"
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {running ? "Importing..." : "Import Manual Entries"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Results area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Messages */}
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-red-900 bg-red-950/30 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-900 bg-emerald-950/30 px-4 py-3">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <p className="text-sm text-emerald-400">{successMsg}</p>
            </div>
          )}

          {importMsg && (
            <div className="flex items-center gap-3 rounded-lg border border-blue-900 bg-blue-950/30 px-4 py-3">
              <CheckCircle className="h-4 w-4 text-blue-500" />
              <p className="text-sm text-blue-400">{importMsg}</p>
            </div>
          )}

          {/* Manual entry form */}
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
                  <div
                    key={i}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <Input
                      className="col-span-4"
                      placeholder="Business name *"
                      value={row.business_name}
                      onChange={(e) =>
                        updateManualRow(i, "business_name", e.target.value)
                      }
                    />
                    <Input
                      className="col-span-2"
                      placeholder="City"
                      value={row.city}
                      onChange={(e) =>
                        updateManualRow(i, "city", e.target.value)
                      }
                    />
                    <Input
                      className="col-span-1"
                      placeholder="ST"
                      value={row.state}
                      onChange={(e) =>
                        updateManualRow(i, "state", e.target.value)
                      }
                    />
                    <Input
                      className="col-span-4"
                      placeholder="website.com"
                      value={row.website}
                      onChange={(e) =>
                        updateManualRow(i, "website", e.target.value)
                      }
                    />
                    <button
                      onClick={() => removeManualRow(i)}
                      className="col-span-1 text-center text-zinc-500 hover:text-red-400 transition-colors"
                      type="button"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addManualRow}
                >
                  <Plus className="h-4 w-4" />
                  Add Row
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Discovery Results Table */}
          {source !== "manual" && (
            <DiscoveryResultsTable
              results={results}
              onImport={handleImportSelected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Creates a CSV FormData blob from manual rows for the existing import API.
 */
function createManualCsvBlob(rows: ManualRow[]): FormData {
  const header = "business_name,city,state,website,source,niche";
  const csvRows = rows.map(
    (r) =>
      `"${esc(r.business_name)}","${esc(r.city)}","${esc(r.state)}","${esc(r.website)}","manual",""`
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
