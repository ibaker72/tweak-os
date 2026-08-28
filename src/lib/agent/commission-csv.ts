/**
 * CSV export of an agent's commission ledger — pure.
 *
 * On straight commission this file is the agent's entire compensation record.
 * It has to stand on its own in a spreadsheet, months later, without anyone
 * present to explain it. That drives three decisions:
 *
 *   Every row carries the basis and the rate that produced it, so any amount
 *   can be re-derived by hand rather than taken on trust.
 *
 *   Money is written as a decimal string built from integer cents. No float
 *   ever touches it, and no locale formatting — a thousands separator turns
 *   into a column break the moment the file is opened somewhere else.
 *
 *   The totals row is part of the export, so the file reconciles against the
 *   balance the agent saw on screen.
 */

export interface LedgerCsvRow {
  created_at: string;
  entry_type: string;
  deal_name: string | null;
  account_name: string | null;
  basis_cents: number | null;
  rate_bps_applied: number | null;
  amount_cents: number;
  payable_at: string;
  payout_batch_id: string | null;
  batch_status: string | null;
  batch_paid_at: string | null;
  memo: string | null;
}

export const CSV_HEADERS = [
  "Date",
  "Type",
  "Account",
  "Deal",
  "Basis (USD)",
  "Rate (%)",
  "Amount (USD)",
  "Payable date",
  "Batch status",
  "Paid on",
  "Memo",
] as const;

/**
 * Integer cents to a plain decimal string: 240000 -> "2400.00", -9050 -> "-90.50".
 *
 * Built by string surgery on the integer rather than division, so no rounding
 * error can enter at the last step of a record that is meant to be exact.
 */
export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`expected integer cents, got ${cents}`);
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Basis points to a percentage string: 3000 -> "30.00". */
export function bpsToPercentString(bps: number): string {
  if (!Number.isInteger(bps)) {
    throw new Error(`expected integer bps, got ${bps}`);
  }
  const negative = bps < 0;
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** ISO timestamp to YYYY-MM-DD. Empty string for a missing date. */
export function isoToDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Quote a CSV field.
 *
 * Always quotes rather than quoting conditionally: a memo an agent typed can
 * contain a comma, a quote, or a newline, and a field that starts with =, +,
 * -, or @ is executed as a formula by Excel and Sheets. Prefixing those with a
 * single quote neutralises it without changing what a human reads.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function batchStatusLabel(row: LedgerCsvRow): string {
  if (!row.payout_batch_id) return "Unpaid";
  return row.batch_status ? row.batch_status : "Batched";
}

/**
 * Render the ledger as CSV, ending with a totals row that reconciles against
 * the on-screen balance.
 */
export function buildCommissionCsv(rows: LedgerCsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.map(csvField).join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvField(isoToDate(row.created_at)),
        csvField(row.entry_type),
        csvField(row.account_name ?? ""),
        csvField(row.deal_name ?? ""),
        csvField(row.basis_cents === null ? "" : centsToDecimalString(row.basis_cents)),
        csvField(
          row.rate_bps_applied === null ? "" : bpsToPercentString(row.rate_bps_applied)
        ),
        csvField(centsToDecimalString(row.amount_cents)),
        csvField(isoToDate(row.payable_at)),
        csvField(batchStatusLabel(row)),
        csvField(isoToDate(row.batch_paid_at)),
        csvField(row.memo ?? ""),
      ].join(",")
    );
  }

  const total = rows.reduce((t, r) => t + r.amount_cents, 0);
  const unpaid = rows
    .filter((r) => !r.payout_batch_id)
    .reduce((t, r) => t + r.amount_cents, 0);

  lines.push("");
  lines.push(
    [
      csvField("TOTAL"),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(centsToDecimalString(total)),
      csvField(""),
      csvField(`${rows.length} entries`),
      csvField(""),
      csvField(""),
    ].join(",")
  );
  lines.push(
    [
      csvField("UNPAID BALANCE"),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(centsToDecimalString(unpaid)),
      csvField(""),
      csvField(""),
      csvField(""),
      csvField(""),
    ].join(",")
  );

  // CRLF: what every spreadsheet expects, and what RFC 4180 specifies.
  return lines.join("\r\n");
}

/** Stable, sortable filename: commissions_<agent>_<YYYY-MM-DD>.csv */
export function commissionCsvFilename(agentName: string, now: Date = new Date()): string {
  const slug =
    agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent";
  return `commissions_${slug}_${now.toISOString().slice(0, 10)}.csv`;
}
