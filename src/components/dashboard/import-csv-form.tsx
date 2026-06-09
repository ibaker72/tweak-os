"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle, XCircle } from "lucide-react";

interface ImportResult {
  job_id: string;
  detected_format?: "standard" | "nj_business_records";
  total_rows: number;
  imported_rows: number;
  skipped_duplicates?: number;
  failed_rows: number;
  errors: { row: number; message: string }[];
  first_failure_reasons?: string[];
}

export function ImportCsvForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
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
        <Card className="border-lime-900">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-lime-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-50">Import Complete</p>
                {result.detected_format === "nj_business_records" && (
                  <p className="text-xs text-zinc-500">
                    Detected format: NJ Business Records
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ResultStat label="Total" value={result.total_rows} tone="muted" />
                  <ResultStat label="Imported" value={result.imported_rows} tone="success" />
                  <ResultStat label="Skipped" value={result.skipped_duplicates ?? 0} tone="warn" />
                  <ResultStat label="Failed" value={result.failed_rows} tone="danger" />
                </dl>
              </div>
            </div>
            {result.first_failure_reasons && result.first_failure_reasons.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-zinc-300">
                  First {result.first_failure_reasons.length} failure reasons:
                </p>
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md bg-zinc-900 p-3">
                  {result.first_failure_reasons.map((msg, i) => (
                    <p key={i} className="text-xs text-zinc-500">
                      {msg}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "success" | "warn" | "danger";
}) {
  const color =
    tone === "success"
      ? "text-lime-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "danger"
          ? "text-red-400"
          : "text-zinc-300";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-center">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</dd>
    </div>
  );
}
