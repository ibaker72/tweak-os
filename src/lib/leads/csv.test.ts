import { describe, it, expect } from "vitest";
import { parseCsvContent } from "./csv";

describe("parseCsvContent — standard format", () => {
  it("parses our normal CSV", () => {
    const csv = [
      "business_name,website,phone,email,city,state,industry",
      "Acme Co,acme.com,555-1212,sales@acme.com,Newark,NJ,roofing",
      "Beta LLC,,,,Trenton,NJ,plumbing",
    ].join("\n");

    const result = parseCsvContent(csv);
    expect(result.detectedFormat).toBe("standard");
    expect(result.totalRows).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.valid[0].business_name).toBe("Acme Co");
    expect(result.valid[0].website).toBe("https://acme.com");
    expect(result.valid[1].business_name).toBe("Beta LLC");
    expect(result.valid[1].phone).toBeUndefined();
  });

  it("requires business_name", () => {
    const csv = [
      "business_name,website",
      ",https://no-name.com",
    ].join("\n");

    const result = parseCsvContent(csv);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/business name/i);
  });
});

describe("parseCsvContent — NJ Business Records format", () => {
  it("detects NJ format from BusinessName header", () => {
    const csv = [
      "BusinessID,BusinessName,Status,FilingDate,TypeCode,StateDom,RegAgent",
      "1234567,Acme Roofing LLC,Active,2024-01-15,LLC,NJ,John Smith",
    ].join("\n");

    const result = parseCsvContent(csv);
    expect(result.detectedFormat).toBe("nj_business_records");
  });

  it("maps NJ columns to lead fields", () => {
    const csv = [
      "BusinessID,BusinessName,Status,FilingDate,TypeCode,StateDom,RegAgent",
      "0400999900,Test Trucking LLC,Active,2023-05-12,LLC,NJ,Jane Doe",
    ].join("\n");

    const { valid, errors } = parseCsvContent(csv);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
    const row = valid[0];
    expect(row.business_name).toBe("Test Trucking LLC");
    expect(row.state).toBe("NJ");
    expect(row.source).toBe("NJ Business Records");
    expect(row.external_id).toBe("0400999900");
    expect(row.entity_type).toBe("LLC");
    expect(row.entity_status).toBe("Active");
    expect(row.source_filing_date).toBe("2023-05-12");
    expect(row.registered_agent).toBe("Jane Doe");
    expect(row.import_notes).toContain("BusinessID: 0400999900");
    expect(row.import_notes).toContain("TypeCode: LLC");
  });

  it("does not fail rows missing website/phone/email/city/industry", () => {
    const csv = [
      "BusinessID,BusinessName,Status,FilingDate,TypeCode,StateDom",
      "111,Sparse Co,Active,2024-01-01,DP,NJ",
      "222,No Status Co,,,LLC,",
      "333,,Active,2024-01-01,LLC,NJ",
    ].join("\n");

    const result = parseCsvContent(csv);
    expect(result.detectedFormat).toBe("nj_business_records");
    // Rows 1 and 2 should validate (name present). Row 3 should fail (missing name).
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(4);
  });

  it("defaults state to NJ when StateDom is empty", () => {
    const csv = [
      "BusinessID,BusinessName,Status,StateDom",
      "111,Defaultland Co,Active,",
    ].join("\n");

    const { valid } = parseCsvContent(csv);
    expect(valid[0].state).toBe("NJ");
  });
});
