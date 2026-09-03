import { describe, it, expect } from "vitest";
import { buildImportSummary, describeRowResult, toRowResults } from "./import-result";
import { parseCsvContent } from "./csv";
import { toBulkImportRow } from "./agent-import";
import { csvLeadRowSchema } from "@/lib/validators/import";

describe("row result wording", () => {
  it("names the tier that matched so a skip does not read as a failure", () => {
    expect(
      describeRowResult({ row: 2, business_name: "ABC Plumbing", status: "imported" })
    ).toBe("Imported");
    expect(
      describeRowResult({
        row: 3,
        business_name: "XYZ HVAC",
        status: "duplicate_skipped",
        reason: "phone",
      })
    ).toBe("Skipped: existing phone match");
    expect(
      describeRowResult({
        row: 4,
        business_name: "Smith Electric",
        status: "duplicate_skipped",
        reason: "domain",
      })
    ).toBe("Skipped: existing domain match");
  });

  it("says when the existing lead belongs to another partner", () => {
    expect(
      describeRowResult({
        row: 5,
        business_name: "Delta Roofing",
        status: "duplicate_skipped",
        reason: "phone",
        owned_by_other_agent: true,
      })
    ).toBe("Skipped: existing phone match (owned by another partner)");
  });

  it("passes the reason through on invalid and failed rows", () => {
    expect(
      describeRowResult({
        row: 6,
        business_name: null,
        status: "invalid",
        message: "Business name is required",
      })
    ).toBe("Invalid: Business name is required");
    expect(
      describeRowResult({ row: 7, business_name: "X", status: "failed", message: "boom" })
    ).toBe("Failed: boom");
  });
});

describe("toRowResults", () => {
  it("renumbers the database's row index back to the spreadsheet line", () => {
    const results = toRowResults(
      [
        { row: 1, business_name: "A", status: "imported" },
        { row: 2, business_name: "B", status: "duplicate_skipped", reason: "phone" },
      ],
      // The parser dropped the file's row 2, so what the database calls row 2
      // is the partner's row 4.
      (index) => [2, 4][index - 1]
    );
    expect(results.map((r) => r.row)).toEqual([2, 4]);
  });

  it("drops anything that is not a recognised row result", () => {
    expect(toRowResults(null, (i) => i)).toEqual([]);
    expect(toRowResults([{ row: 1, status: "nonsense" }], (i) => i)).toEqual([]);
  });
});

describe("buildImportSummary", () => {
  const rpcResult = {
    job_id: "job-1",
    total_rows: 14,
    imported_rows: 7,
    skipped_duplicates: 7,
    invalid_rows: 0,
    failed_rows: 0,
    results: [
      { row: 1, business_name: "ABC Plumbing", status: "imported" },
      {
        row: 2,
        business_name: "XYZ HVAC",
        status: "duplicate_skipped",
        reason: "phone",
      },
    ],
    results_truncated: false,
    failures: [],
  };

  it("reports the five counts the database actually produced", () => {
    const summary = buildImportSummary({
      rpcResult,
      parseErrors: [],
      validRowNumbers: [2, 3],
      totalRows: 14,
      detectedFormat: "standard",
    });

    expect(summary).toMatchObject({
      job_id: "job-1",
      total_rows: 14,
      imported_rows: 7,
      skipped_duplicates: 7,
      invalid_rows: 0,
      failed_rows: 0,
    });
    // 7 + 7 + 0 + 0 adds up to the file the partner uploaded.
    expect(
      summary.imported_rows +
        summary.skipped_duplicates +
        summary.invalid_rows +
        summary.failed_rows
    ).toBe(summary.total_rows);
  });

  it("folds the parser's rejections in as invalid rows, in file order", () => {
    const summary = buildImportSummary({
      rpcResult: { ...rpcResult, invalid_rows: 1, total_rows: 3 },
      parseErrors: [{ row: 3, message: "Business name is required" }],
      // The database's row 1 is the file's row 2; its row 2 is the file's row 4.
      validRowNumbers: [2, 4],
      totalRows: 3,
      detectedFormat: "standard",
    });

    expect(summary.results.map((r) => [r.row, r.status])).toEqual([
      [2, "imported"],
      [3, "invalid"],
      [4, "duplicate_skipped"],
    ]);
  });

  it("keeps the older error fields populated for anything still reading them", () => {
    const summary = buildImportSummary({
      rpcResult: { ...rpcResult, failures: [{ row: 2, message: "Failed to import X: boom" }] },
      parseErrors: [{ row: 9, message: "Business name is required" }],
      validRowNumbers: [2, 3],
      totalRows: 14,
      detectedFormat: "nj_business_records",
    });
    expect(summary.detected_format).toBe("nj_business_records");
    expect(summary.first_failure_reasons).toEqual([
      "Business name is required",
      "Failed to import X: boom",
    ]);
  });

  it("carries the self-sourced marker only when the caller sets it", () => {
    const base = { rpcResult, parseErrors: [], validRowNumbers: [2, 3], totalRows: 14 };
    expect(
      buildImportSummary({ ...base, detectedFormat: "standard" }).attribution
    ).toBeUndefined();
    expect(
      buildImportSummary({
        ...base,
        detectedFormat: "standard",
        attribution: "self_sourced",
      }).attribution
    ).toBe("self_sourced");
  });
});

describe("row numbering survives the round trip from a real CSV", () => {
  it("points at the spreadsheet line the partner has to fix", () => {
    const csv = [
      "Company,City,State,Phone",
      "ABC Plumbing,Paterson,NJ,(862) 555-1212",
      ",Newark,NJ,9735550100",
      "XYZ HVAC,Newark,NJ,9735550100",
    ].join("\n");

    const parsed = parseCsvContent(csv);
    expect(parsed.totalRows).toBe(3);
    // Row 3 of the sheet has no company name and never reaches the database.
    expect(parsed.errors).toEqual([
      { row: 3, message: "Business name is required" },
    ]);
    expect(parsed.validRowNumbers).toEqual([2, 4]);

    const summary = buildImportSummary({
      rpcResult: {
        total_rows: 3,
        imported_rows: 1,
        skipped_duplicates: 1,
        invalid_rows: 1,
        failed_rows: 0,
        results: [
          { row: 1, business_name: "ABC Plumbing", status: "imported" },
          { row: 2, business_name: "XYZ HVAC", status: "duplicate_skipped", reason: "phone" },
        ],
        failures: [],
      },
      parseErrors: parsed.errors,
      validRowNumbers: parsed.validRowNumbers,
      totalRows: parsed.totalRows,
      detectedFormat: parsed.detectedFormat,
    });

    expect(summary.results.map((r) => [r.row, r.business_name, r.status])).toEqual([
      [2, "ABC Plumbing", "imported"],
      [3, null, "invalid"],
      [4, "XYZ HVAC", "duplicate_skipped"],
    ]);
  });
});

describe("the bulk import payload", () => {
  const parse = (raw: Record<string, unknown>) => csvLeadRowSchema.parse(raw);

  it("carries the NJ columns the admin importer writes", () => {
    const row = toBulkImportRow(
      parse({
        business_name: "NJ Co",
        state: "NJ",
        source: "NJ Business Records",
        external_id: "NJ-0001",
        entity_type: "DP",
        entity_status: "Active",
        registered_agent: "Jane Doe",
        source_filing_date: "3/9/2004",
        import_notes: "BusinessID: NJ-0001",
      })
    );

    expect(row).toMatchObject({
      business_name: "NJ Co",
      state: "NJ",
      source: "NJ Business Records",
      external_id: "NJ-0001",
      entity_type: "DP",
      entity_status: "Active",
      registered_agent: "Jane Doe",
      // Coerced to ISO here rather than in SQL, so an unparseable date costs
      // the field and not the whole row.
      source_filing_date: "2004-03-09",
    });
  });

  it("drops a filing date it cannot read instead of failing the row", () => {
    const row = toBulkImportRow(
      parse({ business_name: "NJ Co", source_filing_date: "not a date" })
    );
    expect(row.source_filing_date).toBeUndefined();
    expect(row.business_name).toBe("NJ Co");
  });

  it("still names no owner", () => {
    const row = toBulkImportRow(parse({ business_name: "NJ Co", state: "NJ" })) as unknown as
      Record<string, unknown>;
    for (const key of ["assigned_to", "agent_id", "created_by", "attribution", "rate"]) {
      expect(row[key]).toBeUndefined();
    }
  });
});
