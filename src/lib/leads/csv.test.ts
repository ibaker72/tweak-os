import { describe, it, expect } from "vitest";
import {
  COMBINED_LOCATION_LABEL,
  mapStandardHeader,
  parseCsvContent,
  splitCityState,
} from "./csv";

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

  it("maps registered-agent address fields to address/zip", () => {
    const csv = [
      "BusinessID,BusinessName,Status,StateDom,RegAgent,RegAgentStreet,RegAgentCity,RegAgentZip",
      "222,Tidy Trades LLC,Active,NJ,Jane Doe,123 Main St,Newark,07102",
    ].join("\n");

    const { valid, errors } = parseCsvContent(csv);
    expect(errors).toEqual([]);
    expect(valid[0].address).toBe("123 Main St");
    expect(valid[0].city).toBe("Newark");
    expect(valid[0].zip).toBe("07102");
    // Address info should also appear in import_notes for completeness.
    expect(valid[0].import_notes).toContain("RegAgentAddress: 123 Main St");
    expect(valid[0].import_notes).toContain("RegAgentZip: 07102");
  });

  it("accepts alternative registered-agent address column spellings", () => {
    // BusinessName + RegAgent satisfy the NJ format detector; the address
    // columns vary by export type so we accept several spellings.
    const csv = [
      "BusinessName,RegAgent,RegAgentAddress1,RegAgentZIPCode",
      "Alt Address Co,Jane,42 Elm Ave,08540",
    ].join("\n");

    const { valid } = parseCsvContent(csv);
    expect(valid[0].address).toBe("42 Elm Ave");
    expect(valid[0].zip).toBe("08540");
  });
});

describe("parseCsvContent — agent research sheet headers", () => {
  it("maps Mary's column names onto lead fields", () => {
    const csv = [
      "Company,Type,City,State,Decision Maker,Email,Website,Phone,Notes",
      "Rockstar Beauty,Salon,Newark,NJ,Dana Reed,dana@rockstar.com,rockstar.com,555-0100,Met at expo",
    ].join("\n");

    const { valid, errors, detectedFormat } = parseCsvContent(csv);
    expect(detectedFormat).toBe("standard");
    expect(errors).toEqual([]);
    const row = valid[0];
    expect(row.business_name).toBe("Rockstar Beauty");
    expect(row.niche).toBe("Salon");
    expect(row.city).toBe("Newark");
    expect(row.state).toBe("NJ");
    expect(row.contact_name).toBe("Dana Reed");
    expect(row.email).toBe("dana@rockstar.com");
    expect(row.website).toBe("https://rockstar.com");
    expect(row.phone).toBe("555-0100");
    expect(row.notes).toBe("Met at expo");
  });

  it("accepts the alternative spellings of each header", () => {
    const csv = [
      "Business Name,Industry,Contact Name,Phone Number",
      "Acme Roofing,Roofing,Sam Vale,555-0111",
    ].join("\n");

    const { valid, errors } = parseCsvContent(csv);
    expect(errors).toEqual([]);
    expect(valid[0].business_name).toBe("Acme Roofing");
    expect(valid[0].niche).toBe("Roofing");
    expect(valid[0].contact_name).toBe("Sam Vale");
    expect(valid[0].phone).toBe("555-0111");
  });

  it("parses a combined 'City, State' column into both fields", () => {
    const csv = ['Company Name,"City, State"', "Beta LLC,\"Trenton, NJ\""].join("\n");

    const { valid, errors } = parseCsvContent(csv);
    expect(errors).toEqual([]);
    expect(valid[0].city).toBe("Trenton");
    expect(valid[0].state).toBe("NJ");
  });

  it("splits a City column that holds 'Newark, NJ' when there is no state column", () => {
    const csv = ["Company,City", 'Gamma Co,"Newark, NJ"'].join("\n");

    const { valid } = parseCsvContent(csv);
    expect(valid[0].city).toBe("Newark");
    expect(valid[0].state).toBe("NJ");
  });

  it("leaves a comma-bearing city alone when the tail is not a state", () => {
    const csv = ["Company,City", 'Delta Co,"Newark, Downtown"'].join("\n");

    const { valid } = parseCsvContent(csv);
    expect(valid[0].city).toBe("Newark, Downtown");
    expect(valid[0].state).toBeUndefined();
  });

  it("does not let a combined column overwrite an explicit state column", () => {
    const csv = ['Company,"City, State",State', 'Epsilon Co,"Newark, NJ",PA'].join("\n");

    const { valid } = parseCsvContent(csv);
    expect(valid[0].state).toBe("PA");
  });

  it("keeps an explicit business_name column when Company is also present", () => {
    const csv = ["business_name,Company", "Canonical LLC,Alias LLC"].join("\n");

    const { valid } = parseCsvContent(csv);
    expect(valid[0].business_name).toBe("Canonical LLC");
  });
});

describe("mapStandardHeader", () => {
  it("reports the field each supported header lands in", () => {
    expect(mapStandardHeader("Company")).toBe("business_name");
    expect(mapStandardHeader("Business Name")).toBe("business_name");
    expect(mapStandardHeader("Type")).toBe("niche");
    expect(mapStandardHeader("Industry")).toBe("niche");
    expect(mapStandardHeader("Decision Maker")).toBe("contact_name");
    expect(mapStandardHeader("Phone Number")).toBe("phone");
    expect(mapStandardHeader("City, State")).toBe(COMBINED_LOCATION_LABEL);
    expect(mapStandardHeader("Notes")).toBe("notes");
  });

  it("still reports the original snake_case headers", () => {
    expect(mapStandardHeader("business_name")).toBe("business_name");
    expect(mapStandardHeader("external_id")).toBe("external_id");
    expect(mapStandardHeader("source")).toBe("source");
  });

  it("returns null for a column the importer ignores", () => {
    expect(mapStandardHeader("Random Column")).toBeNull();
    expect(mapStandardHeader("assigned_to")).toBeNull();
    expect(mapStandardHeader("agent_id")).toBeNull();
  });
});

describe("splitCityState", () => {
  it("splits a two-letter state code", () => {
    expect(splitCityState("Newark, NJ")).toEqual({ city: "Newark", state: "NJ" });
  });

  it("splits a spelled-out state", () => {
    expect(splitCityState("Newark, New Jersey")).toEqual({
      city: "Newark",
      state: "New Jersey",
    });
  });

  it("uppercases a lowercase abbreviation", () => {
    expect(splitCityState("Trenton, nj")).toEqual({ city: "Trenton", state: "NJ" });
  });

  it("returns the whole value as a city when there is no comma", () => {
    expect(splitCityState("Ho-Ho-Kus")).toEqual({ city: "Ho-Ho-Kus" });
  });

  it("does not invent a state from a trailing word that is not one", () => {
    expect(splitCityState("Newark, Essex County")).toEqual({
      city: "Newark, Essex County",
    });
  });
});
