import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsvContent } from "./csv";
import {
  FORBIDDEN_IMPORT_KEYS,
  toAgentImportRow,
  toAgentImportRows,
} from "./agent-import";
import { csvLeadRowSchema } from "@/lib/validators/import";

function parseRow(csv: string) {
  const { valid, errors } = parseCsvContent(csv);
  expect(errors).toEqual([]);
  return valid[0];
}

describe("toAgentImportRow", () => {
  it("carries the fields an agent's sheet supplies", () => {
    const row = toAgentImportRow(
      parseRow(
        [
          "Company,Type,City,State,Decision Maker,Email,Website,Phone,Notes",
          "Rockstar Beauty,Salon,Newark,NJ,Dana Reed,dana@rockstar.com,rockstar.com,555-0100,Met at expo",
        ].join("\n")
      )
    );

    expect(row).toEqual({
      business_name: "Rockstar Beauty",
      niche: "Salon",
      city: "Newark",
      state: "NJ",
      contact_name: "Dana Reed",
      email: "dana@rockstar.com",
      website: "https://rockstar.com",
      phone: "555-0100",
      notes: "Met at expo",
    });
  });

  it("drops every ownership and credit field a CSV might carry", () => {
    // Feed the schema directly: these columns are not even parsed out of a
    // CSV, and this asserts the projection would refuse them if they were.
    const parsed = csvLeadRowSchema.parse({
      business_name: "Sneaky LLC",
      state: "NJ",
      source: "referral_link",
    });

    const row = toAgentImportRow({
      ...parsed,
      // Cast because none of these exist on the row type — which is the point.
      ...({
        assigned_to: "00000000-0000-0000-0000-000000000001",
        agent_id: "00000000-0000-0000-0000-000000000001",
        rate_bps: 9999,
        commission_rate_bps: 9999,
        is_override: true,
        created_by: "00000000-0000-0000-0000-000000000001",
      } as Record<string, unknown>),
    });

    for (const key of FORBIDDEN_IMPORT_KEYS) {
      expect(row, `${key} must not survive the projection`).not.toHaveProperty(key);
    }
    expect(row).toEqual({ business_name: "Sneaky LLC", state: "NJ" });
  });

  it("keeps `source` out of the payload even when the CSV sets it", () => {
    const row = toAgentImportRow(
      parseRow(["business_name,source", "Acme Co,NJ Business Records"].join("\n"))
    );
    expect(row).not.toHaveProperty("source");
  });

  it("falls back to the industry column for niche", () => {
    const row = toAgentImportRow(
      parseRow(["business_name,industry", "Acme Co,Roofing"].join("\n"))
    );
    expect(row.niche).toBe("Roofing");
  });

  it("omits empty fields rather than sending blank strings", () => {
    const row = toAgentImportRow(parseRow("business_name,city\nAcme Co,\n"));
    expect(row).toEqual({ business_name: "Acme Co" });
  });

  it("projects a whole file", () => {
    const rows = toAgentImportRows(
      parseCsvContent(
        ["Company,City", "Acme Co,Newark", "Beta LLC,Trenton"].join("\n")
      ).valid
    );
    expect(rows.map((r) => r.business_name)).toEqual(["Acme Co", "Beta LLC"]);
  });
});

describe("the agent import route never hands ownership to the client", () => {
  const routeSrc = readFileSync(
    path.resolve(__dirname, "../../app/api/my/imports/route.ts"),
    "utf8"
  );

  it("authenticates with requireUser and goes through the definer function", () => {
    expect(routeSrc).toContain("const guard = await requireUser()");
    expect(routeSrc).toContain('rpc("import_agent_leads"');
  });

  it("passes no agent identifier to the function", () => {
    // The function derives the crediting agent from the JWT. If a parameter
    // ever appears here, an agent could import onto a teammate.
    expect(routeSrc).not.toMatch(/p_agent|p_assigned_to|agent_id:/);
  });

  it("does not use the service-role client", () => {
    expect(routeSrc).not.toContain("createServiceClient");
    expect(routeSrc).not.toContain("supabase/service");
  });
});

describe("the admin import route is unchanged in shape", () => {
  const adminSrc = readFileSync(
    path.resolve(__dirname, "../../app/api/imports/route.ts"),
    "utf8"
  );

  it("still requires an admin", () => {
    expect(adminSrc).toContain("const guard = await requireAdmin()");
  });

  it("still inserts through insertLead with the shared duplicate check", () => {
    expect(adminSrc).toContain("insertLead");
    expect(adminSrc).toContain("findDuplicateLeadForImport");
  });

  it("does not route admin imports through the agent-credited function", () => {
    // An admin importing the team's leads must not silently credit themselves.
    expect(adminSrc).not.toContain("import_agent_leads");
  });
});
