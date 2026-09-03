"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  XCircle,
} from "lucide-react";
import {
  describeRowResult,
  type ImportRowResult,
  type ImportSummaryResult,
} from "@/lib/leads/import-result";

/**
 * What happened to the file that was just uploaded.
 *
 * Five counts, because "skipped" used to mean two different things and a
 * partner could not tell whether their sheet had a problem. A duplicate is
 * good news — the lead is already in the system. An invalid row is their sheet
 * to fix. A failed row is ours.
 *
 * The per-row list is what makes the counts believable: re-uploading a sheet
 * of fourteen and being told "7 duplicates" is only reassuring if you can see
 * WHICH seven and why each one matched.
 */
export function ImportSummary({
  result,
  title = "Import complete",
  subtitle,
}: {
  result: ImportSummaryResult;
  title?: string;
  subtitle?: string;
}) {
  const [showRows, setShowRows] = useState(false);

  const hasProblems = result.invalid_rows > 0 || result.failed_rows > 0;

  return (
    <Card className={hasProblems ? "border-amber-900" : "border-lime-900"}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {hasProblems ? (
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          ) : (
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-lime-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-50">{title}</p>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
            {result.detected_format === "nj_business_records" && (
              <p className="mt-0.5 text-xs text-zinc-500">
                Detected format: NJ Business Records
              </p>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <ResultStat label="Processed" value={result.total_rows} tone="muted" />
              <ResultStat label="Imported" value={result.imported_rows} tone="success" />
              <ResultStat label="Duplicates" value={result.skipped_duplicates} tone="warn" />
              <ResultStat label="Invalid" value={result.invalid_rows} tone="warn" />
              <ResultStat label="Failed" value={result.failed_rows} tone="danger" />
            </dl>

            {result.skipped_duplicates > 0 && (
              <p className="mt-3 text-xs text-zinc-400">
                {result.skipped_duplicates}{" "}
                {result.skipped_duplicates === 1 ? "row was" : "rows were"} already in
                the system and {result.skipped_duplicates === 1 ? "was" : "were"} left
                exactly as {result.skipped_duplicates === 1 ? "it is" : "they are"} —
                same owner, same status, same history.
              </p>
            )}
          </div>
        </div>

        {result.results.length > 0 && (
          <div className="mt-4 border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => setShowRows((open) => !open)}
              className="flex w-full items-center gap-1.5 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100"
              aria-expanded={showRows}
            >
              {showRows ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {showRows ? "Hide" : "Show"} row-by-row results
              <span className="text-zinc-600">({result.results.length})</span>
            </button>

            {showRows && (
              <>
                <ul className="mt-2 max-h-72 divide-y divide-zinc-900 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950">
                  {result.results.map((row) => (
                    <RowLine key={`${row.row}-${row.business_name ?? ""}`} row={row} />
                  ))}
                </ul>
                {result.results_truncated && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Showing the first {result.results.length} rows. The counts above
                    cover the whole file.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RowLine({ row }: { row: ImportRowResult }) {
  const tone =
    row.status === "imported"
      ? "text-lime-400"
      : row.status === "duplicate_skipped"
        ? "text-amber-400"
        : row.status === "invalid"
          ? "text-zinc-400"
          : "text-red-400";

  const Icon =
    row.status === "imported"
      ? CheckCircle
      : row.status === "duplicate_skipped"
        ? CircleSlash
        : row.status === "invalid"
          ? CircleAlert
          : XCircle;

  return (
    <li className="flex items-start gap-2 px-3 py-2 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="w-8 shrink-0 tabular-nums text-zinc-600">{row.row}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-300">
        {row.business_name ?? "—"}
      </span>
      <span className={`shrink-0 text-right ${tone}`}>{describeRowResult(row)}</span>
    </li>
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
