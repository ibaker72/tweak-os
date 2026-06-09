import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseCsvContent } from "./csv";

const NJ_SAMPLE = "/tmp/EntityList_20260606_261604127542.csv";

describe.skipIf(!existsSync(NJ_SAMPLE))("NJ sample CSV end-to-end", () => {
  it("parses the sample NJ entity list with most rows valid", () => {
    const csv = readFileSync(NJ_SAMPLE, "utf-8");
    const result = parseCsvContent(csv);

    expect(result.detectedFormat).toBe("nj_business_records");
    // Sample has 14 data rows: 10 clean, 1 missing BusinessID, 1 missing name (fails),
    // 2 duplicates (parsed fine; dedup is database-side).
    expect(result.totalRows).toBe(14);
    // Only the row with missing BusinessName should fail validation.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/business name/i);
    expect(result.valid).toHaveLength(13);

    const first = result.valid[0];
    expect(first.business_name).toBe("ACME ROOFING LLC");
    expect(first.state).toBe("NJ");
    expect(first.source).toBe("NJ Business Records");
    expect(first.external_id).toBe("0400999900");
    expect(first.entity_type).toBe("LLC");
    expect(first.entity_status).toBe("Active");
    expect(first.source_filing_date).toBe("2024-01-15");
    expect(first.registered_agent).toBe("JOHN SMITH");

    // Row missing BusinessID still imports — just without external_id.
    const emptyIdRow = result.valid.find((r) => r.business_name === "EMPTY ID CO");
    expect(emptyIdRow).toBeDefined();
    expect(emptyIdRow?.external_id).toBeUndefined();

    // Blank website/phone/email/industry don't fail rows.
    for (const row of result.valid) {
      expect(row.website).toBeUndefined();
      expect(row.phone).toBeUndefined();
      expect(row.email).toBeUndefined();
    }
  });
});
