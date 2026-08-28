import { describe, it, expect } from "vitest";
import {
  bpsToPercentString,
  buildCommissionCsv,
  centsToDecimalString,
  commissionCsvFilename,
  csvField,
  isoToDate,
  type LedgerCsvRow,
} from "./commission-csv";

function row(overrides: Partial<LedgerCsvRow> = {}): LedgerCsvRow {
  return {
    created_at: "2026-03-01T12:00:00.000Z",
    entry_type: "earned",
    deal_name: "Rapid Build",
    account_name: "Acme HVAC",
    basis_cents: 800_000,
    rate_bps_applied: 3000,
    amount_cents: 240_000,
    payable_at: "2026-03-31T12:00:00.000Z",
    payout_batch_id: null,
    batch_status: null,
    batch_paid_at: null,
    memo: "Commission on payment pay-1",
    ...overrides,
  };
}

describe("centsToDecimalString", () => {
  it("formats whole dollars and cents without a float anywhere", () => {
    expect(centsToDecimalString(240_000)).toBe("2400.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
    expect(centsToDecimalString(100)).toBe("1.00");
  });

  it("keeps the sign on a clawback", () => {
    expect(centsToDecimalString(-9050)).toBe("-90.50");
    expect(centsToDecimalString(-5)).toBe("-0.05");
  });

  it("is exact at magnitudes where a float would drift", () => {
    // 0.1 + 0.2 territory: these must be exact to the cent.
    expect(centsToDecimalString(1_000_000_007)).toBe("10000000.07");
    expect(centsToDecimalString(299)).toBe("2.99");
    expect(centsToDecimalString(70)).toBe("0.70");
  });

  it("rejects a non-integer rather than emitting a sub-cent", () => {
    expect(() => centsToDecimalString(100.5)).toThrow(/integer cents/);
  });

  it("round-trips back to the same cents", () => {
    for (const cents of [0, 1, 99, 100, 12_345, -6789, 240_000]) {
      expect(Math.round(Number(centsToDecimalString(cents)) * 100)).toBe(cents);
    }
  });
});

describe("bpsToPercentString", () => {
  it("renders basis points as a percentage", () => {
    expect(bpsToPercentString(3000)).toBe("30.00");
    expect(bpsToPercentString(2000)).toBe("20.00");
    expect(bpsToPercentString(3333)).toBe("33.33");
    expect(bpsToPercentString(10_000)).toBe("100.00");
    expect(bpsToPercentString(1)).toBe("0.01");
  });
});

describe("isoToDate", () => {
  it("reduces a timestamp to a date", () => {
    expect(isoToDate("2026-03-01T12:00:00.000Z")).toBe("2026-03-01");
  });

  it("returns empty for a missing or unparseable value", () => {
    expect(isoToDate(null)).toBe("");
    expect(isoToDate(undefined)).toBe("");
    expect(isoToDate("not a date")).toBe("");
  });
});

describe("csvField", () => {
  it("always quotes, so a comma in a memo cannot break a column", () => {
    expect(csvField("Discovery call, follow up Tuesday")).toBe(
      '"Discovery call, follow up Tuesday"'
    );
  });

  it("doubles embedded quotes", () => {
    expect(csvField('He said "yes"')).toBe('"He said ""yes"""');
  });

  it("survives a newline inside a memo", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises spreadsheet formula injection", () => {
    // A memo starting with = would execute on open in Excel and Sheets.
    expect(csvField("=1+1")).toBe(`"'=1+1"`);
    expect(csvField("+cmd")).toBe(`"'+cmd"`);
    expect(csvField("-2+3")).toBe(`"'-2+3"`);
    expect(csvField("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
  });

  it("leaves an ordinary negative amount readable", () => {
    // The amount column is generated, not user text, but it does start with -.
    expect(csvField("-90.50")).toBe(`"'-90.50"`);
  });

  it("renders null and undefined as empty", () => {
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });
});

describe("buildCommissionCsv", () => {
  it("writes a header, a row per entry, and reconciling totals", () => {
    const csv = buildCommissionCsv([row()]);
    const lines = csv.split("\r\n");

    expect(lines[0]).toContain("Date");
    expect(lines[0]).toContain("Amount (USD)");
    expect(lines[1]).toContain('"2026-03-01"');
    expect(lines[1]).toContain('"Acme HVAC"');
    expect(lines[1]).toContain('"30.00"');
    expect(lines[1]).toContain('"2400.00"');
    expect(csv).toContain('"TOTAL"');
    expect(csv).toContain('"UNPAID BALANCE"');
  });

  it("carries the basis and rate so any amount can be re-derived by hand", () => {
    const csv = buildCommissionCsv([row()]);
    // 8000.00 basis at 30.00% = 2400.00. All three present on one line.
    const line = csv.split("\r\n")[1];
    expect(line).toContain('"8000.00"');
    expect(line).toContain('"30.00"');
    expect(line).toContain('"2400.00"');
  });

  it("totals reconcile with the entries, clawbacks included", () => {
    const csv = buildCommissionCsv([
      row({ amount_cents: 240_000 }),
      row({ entry_type: "clawback", amount_cents: -60_000, basis_cents: 200_000 }),
    ]);
    // 240,000 earned less 60,000 clawed back = 180,000 cents.
    const totalLine = csv.split("\r\n").find((l) => l.startsWith('"TOTAL"'))!;
    expect(totalLine).toContain('"1800.00"');
  });

  it("separates the unpaid balance from the lifetime total", () => {
    const csv = buildCommissionCsv([
      row({ amount_cents: 100_000, payout_batch_id: "batch-1", batch_status: "paid" }),
      row({ amount_cents: 40_000, payout_batch_id: null }),
    ]);
    const lines = csv.split("\r\n");
    const totalLine = lines.find((l) => l.startsWith('"TOTAL"'))!;
    const unpaidLine = lines.find((l) => l.startsWith('"UNPAID BALANCE"'))!;

    expect(totalLine).toContain('"1400.00"'); // 140,000 cents
    expect(unpaidLine).toContain('"400.00"'); // only the unbatched 40,000
  });

  it("labels batch status honestly", () => {
    const unpaid = buildCommissionCsv([row()]);
    expect(unpaid).toContain('"Unpaid"');

    const paid = buildCommissionCsv([
      row({
        payout_batch_id: "batch-1",
        batch_status: "paid",
        batch_paid_at: "2026-04-15T00:00:00.000Z",
      }),
    ]);
    expect(paid).toContain('"paid"');
    expect(paid).toContain('"2026-04-15"');
  });

  it("handles an empty ledger without producing a misleading file", () => {
    const csv = buildCommissionCsv([]);
    expect(csv).toContain('"TOTAL"');
    expect(csv).toContain('"0.00"');
    expect(csv).toContain('"0 entries"');
  });

  it("leaves basis and rate blank on an entry that has neither", () => {
    const csv = buildCommissionCsv([
      row({ basis_cents: null, rate_bps_applied: null, entry_type: "bonus" }),
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toContain('"bonus"');
    // Two consecutive empty fields where basis and rate would be.
    expect(line).toContain('"","",');
  });

  it("uses CRLF line endings per RFC 4180", () => {
    expect(buildCommissionCsv([row()])).toContain("\r\n");
  });

  it("keeps a memo containing a comma in one field", () => {
    const csv = buildCommissionCsv([row({ memo: "Refund, partial: 25%" })]);
    expect(csv).toContain('"Refund, partial: 25%"');
  });
});

describe("commissionCsvFilename", () => {
  it("is stable and sortable", () => {
    expect(commissionCsvFilename("Agent A", new Date("2026-03-01T00:00:00Z"))).toBe(
      "commissions_agent-a_2026-03-01.csv"
    );
  });

  it("slugifies awkward names", () => {
    expect(commissionCsvFilename("O'Brien & Sons!", new Date("2026-03-01Z"))).toBe(
      "commissions_o-brien-sons_2026-03-01.csv"
    );
  });

  it("falls back when a name slugifies to nothing", () => {
    expect(commissionCsvFilename("!!!", new Date("2026-03-01Z"))).toBe(
      "commissions_agent_2026-03-01.csv"
    );
  });
});
