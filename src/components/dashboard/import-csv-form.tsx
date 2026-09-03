"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportSummaryResult } from "@/lib/leads/import-result";
import { ImportSummary } from "@/components/dashboard/import-summary";
import { Upload, FileText, XCircle } from "lucide-react";

export function ImportCsvForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/imports", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }

      setResult(data);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="cursor-pointer rounded-lg border-2 border-dashed border-zinc-700 px-4 py-10 text-center transition-colors hover:border-zinc-500 sm:px-6 sm:py-8"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mx-auto h-10 w-10 text-zinc-500 sm:h-8 sm:w-8" />
            <p className="mt-3 break-words text-sm text-zinc-300">
              {file ? file.name : "Tap to select a CSV file"}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              <span className="block sm:inline">Standard:</span>{" "}
              <span className="text-zinc-400">business_name, website, phone, email, city, state, industry</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              <span className="block sm:inline">Also accepts:</span>{" "}
              <span className="text-zinc-400">NJ Business Entity List exports (BusinessName, BusinessID, FilingDate, …)</span>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full"
            size="lg"
          >
            <FileText className="h-4 w-4" />
            {uploading ? "Importing..." : "Import CSV"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-900">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-400">{error}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <ImportSummary
          result={result}
          title="Import complete"
          subtitle="Bulk imports stay unassigned; existing leads were skipped, not touched."
        />
      )}
    </div>
  );
}
