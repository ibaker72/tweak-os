import Papa from "papaparse";
import { csvLeadRowSchema, type ValidatedCsvRow } from "@/lib/validators/import";

export interface CsvParseResult {
  valid: ValidatedCsvRow[];
  errors: { row: number; message: string }[];
  totalRows: number;
}

export function parseCsvContent(csvText: string): CsvParseResult {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  const valid: ValidatedCsvRow[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const result = csvLeadRowSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      const messages = result.error.issues.map((e) => e.message).join("; ");
      errors.push({ row: i + 2, message: messages }); // +2 for 1-indexed + header
    }
  }

  return {
    valid,
    errors,
    totalRows: parsed.data.length,
  };
}

export function leadsToCSV(
  leads: Array<Record<string, unknown>>
): string {
  return Papa.unparse(leads);
}
