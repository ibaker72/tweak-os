import { describe, it, expect } from "vitest";
import {
  dedupeKeysFor,
  describeDuplicateReason,
  domainKey,
  duplicateReason,
  emailKey,
  localityConflicts,
  localityKey,
  nameKey,
  normalizeBusinessName,
  normalizeCity,
  normalizeDomain,
  normalizeEmail,
  normalizeState,
  phoneKey,
} from "./normalize";

describe("phone normalization", () => {
  it("folds every way a US number gets typed onto one value", () => {
    const same = ["(862) 555-1212", "8625551212", "+18625551212", "862-555-1212", "1 862 555 1212"];
    const keys = same.map(phoneKey);
    expect(keys).toEqual(Array(same.length).fill("+18625551212"));
  });

  it("keeps different numbers different", () => {
    expect(phoneKey("(862) 555-1212")).not.toBe(phoneKey("(862) 555-1213"));
  });

  it("returns null for something that is not a phone number", () => {
    expect(phoneKey("555")).toBeNull();
    expect(phoneKey("n/a")).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe("email normalization", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(normalizeEmail("TEST@Example.com")).toBe("test@example.com");
    expect(normalizeEmail("  test@example.com  ")).toBe("test@example.com");
    expect(normalizeEmail("TEST@Example.com")).toBe(normalizeEmail("test@example.com"));
  });

  it("ignores empty and malformed values rather than matching on them", () => {
    expect(emailKey("")).toBeNull();
    expect(emailKey("   ")).toBeNull();
    expect(emailKey(null)).toBeNull();
    expect(emailKey("not-an-email")).toBeNull();
    expect(emailKey("missing@tld")).toBeNull();
  });
});

describe("domain normalization", () => {
  it("resolves the three ways one site gets written", () => {
    expect(normalizeDomain("https://www.example.com/")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
    expect(normalizeDomain("example.com/contact")).toBe("example.com");
  });

  it("strips ports, credentials, queries and fragments", () => {
    expect(normalizeDomain("https://user:pw@www.example.com:8443/a/b?c=1#d")).toBe("example.com");
  });

  it("keeps a subdomain, which is a different site", () => {
    expect(normalizeDomain("https://shop.example.com")).toBe("shop.example.com");
  });

  it("returns null for values that are not a website", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain("not a url")).toBeNull();
    expect(normalizeDomain("example.")).toBeNull();
    expect(normalizeDomain("10.0.0.1")).toBeNull();
  });

  it("refuses to match on a host every business can sign up to", () => {
    // Two sole traders both listing a Facebook page are not one business.
    expect(domainKey("https://www.facebook.com/joes-plumbing")).toBeNull();
    expect(domainKey("gmail.com")).toBeNull();
    expect(domainKey("https://wixsite.com")).toBeNull();
    expect(domainKey("https://www.example.com/")).toBe("example.com");
  });
});

describe("business name normalization", () => {
  it("treats a legal suffix and its punctuation as noise", () => {
    expect(normalizeBusinessName("ABC Plumbing LLC")).toBe("abc plumbing");
    expect(normalizeBusinessName("ABC Plumbing, LLC")).toBe("abc plumbing");
    expect(normalizeBusinessName("ABC Plumbing")).toBe("abc plumbing");
    expect(normalizeBusinessName("A.B.C. Plumbing")).toBe("abc plumbing");
    expect(normalizeBusinessName("  abc   plumbing  ")).toBe("abc plumbing");
  });

  it("reads & and 'and' the same way, and strips stacked suffixes", () => {
    expect(normalizeBusinessName("Smith & Sons Co LLC")).toBe("smith and sons");
    expect(normalizeBusinessName("Smith and Sons")).toBe("smith and sons");
  });

  it("never normalizes a name down to nothing", () => {
    // "The Company" loses its suffix and keeps "the" rather than emptying out;
    // a business genuinely called "LLC" keeps that, because the suffix strip
    // never takes the last token.
    expect(normalizeBusinessName("The Company")).toBe("the");
    expect(normalizeBusinessName("LLC")).toBe("llc");
    // Neither survives as a dedupe key, which is the point — a name that
    // reduces to a filler word is not an identifier.
    expect(nameKey("The Company")).toBeNull();
    expect(nameKey("LLC")).toBeNull();
  });

  it("refuses to use a name that only says what the business does", () => {
    // A sheet full of these would otherwise collapse to one lead per town.
    expect(nameKey("Plumbing")).toBeNull();
    expect(nameKey("Plumbing Services")).toBeNull();
    expect(nameKey("Auto Repair")).toBeNull();
    expect(nameKey("Best Local Cleaning Services LLC")).toBeNull();
    expect(nameKey("ABC Plumbing")).toBe("abc plumbing");
  });

  it("returns null for an empty or near-empty name", () => {
    expect(nameKey("")).toBeNull();
    expect(nameKey("   ")).toBeNull();
    expect(nameKey(null)).toBeNull();
    expect(nameKey("!!")).toBeNull();
  });
});

describe("location normalization", () => {
  it("folds a spelled-out state onto its code", () => {
    expect(normalizeState("New Jersey")).toBe("NJ");
    expect(normalizeState("new jersey")).toBe("NJ");
    expect(normalizeState("nj")).toBe("NJ");
    expect(normalizeState("N.J.")).toBe("NJ");
  });

  it("normalizes city punctuation and spacing", () => {
    expect(normalizeCity("  Paterson ")).toBe("paterson");
    expect(normalizeCity("St. Louis")).toBe("st louis");
    expect(normalizeCity("St Louis")).toBe(normalizeCity("St. Louis"));
    expect(normalizeCity("Newark")).toBe(normalizeCity("NEWARK"));
  });

  it("composes a locality key only when something is known", () => {
    expect(localityKey("Paterson", "NJ")).toBe("paterson|NJ");
    expect(localityKey(null, "New Jersey")).toBe("|NJ");
    expect(localityKey("Paterson", null)).toBe("paterson|");
    expect(localityKey(null, null)).toBeNull();
  });

  it("counts only a stated disagreement as a conflict", () => {
    const paterson = dedupeKeysFor({ city: "Paterson", state: "NJ" });
    const newark = dedupeKeysFor({ city: "Newark", state: "NJ" });
    const njOnly = dedupeKeysFor({ state: "NJ" });
    const nowhere = dedupeKeysFor({});

    expect(localityConflicts(paterson, newark)).toBe(true);
    // A missing city is unknown, not different. A re-exported sheet that
    // dropped a column must not read as a different business.
    expect(localityConflicts(paterson, njOnly)).toBe(false);
    expect(localityConflicts(paterson, nowhere)).toBe(false);
    expect(localityConflicts(paterson, paterson)).toBe(false);
  });
});

describe("the duplicate policy", () => {
  const keys = (row: Parameters<typeof dedupeKeysFor>[0]) => dedupeKeysFor(row);

  it("matches on phone however either side was typed", () => {
    expect(
      duplicateReason(
        keys({ business_name: "ABC Plumbing", phone: "(862) 555-1212" }),
        keys({ business_name: "Totally Different Name", phone: "+18625551212" })
      )
    ).toBe("phone");
  });

  it("matches on email regardless of case", () => {
    expect(
      duplicateReason(
        keys({ business_name: "Zeta Co", email: "TEST@Example.com" }),
        keys({ business_name: "Zeta Company", email: "test@example.com" })
      )
    ).toBe("email");
  });

  it("matches on domain across protocol, www and path", () => {
    expect(
      duplicateReason(
        keys({ business_name: "Zeta Co", website: "example.com/contact" }),
        keys({ business_name: "Zeta Co", website: "https://www.example.com/" })
      )
    ).toBe("domain");
  });

  it("falls back to name plus location when there is no stronger identifier", () => {
    expect(
      duplicateReason(
        keys({ business_name: "ABC Plumbing LLC", city: "Paterson", state: "NJ" }),
        keys({ business_name: "ABC Plumbing, LLC", city: "Paterson", state: "NJ" })
      )
    ).toBe("name_location");
  });

  it("does NOT merge the same name in two cities", () => {
    expect(
      duplicateReason(
        keys({ business_name: "ABC Plumbing", city: "Paterson", state: "NJ" }),
        keys({ business_name: "ABC Plumbing", city: "Newark", state: "NJ" })
      )
    ).toBeNull();
  });

  it("does NOT merge the same name in two states", () => {
    expect(
      duplicateReason(
        keys({ business_name: "ABC Plumbing", state: "NJ" }),
        keys({ business_name: "ABC Plumbing", state: "PA" })
      )
    ).toBeNull();
  });

  it("keeps two franchise locations apart when they share a corporate domain", () => {
    expect(
      duplicateReason(
        keys({ business_name: "Sandwich Co", city: "Paterson", state: "NJ", website: "sandwichco.com" }),
        keys({ business_name: "Sandwich Co", city: "Newark", state: "NJ", website: "https://www.sandwichco.com" })
      )
    ).toBeNull();
  });

  it("keeps two franchise locations apart when they share an info@ address", () => {
    expect(
      duplicateReason(
        keys({ business_name: "Sandwich Co", city: "Paterson", state: "NJ", email: "info@sandwichco.com" }),
        keys({ business_name: "Sandwich Co", city: "Newark", state: "NJ", email: "INFO@sandwichco.com" })
      )
    ).toBeNull();
  });

  it("still matches a franchise location on its own phone number", () => {
    // Location matters for a shared domain. It does not override a direct
    // line, which one branch answers.
    expect(
      duplicateReason(
        keys({ business_name: "Sandwich Co", city: "Paterson", state: "NJ", phone: "8625551212" }),
        keys({ business_name: "Sandwich Co", city: "Newark", state: "NJ", phone: "(862) 555-1212" })
      )
    ).toBe("phone");
  });

  it("does not merge two generic names in one city", () => {
    expect(
      duplicateReason(
        keys({ business_name: "Plumbing Services", city: "Newark", state: "NJ" }),
        keys({ business_name: "Plumbing Services", city: "Newark", state: "NJ" })
      )
    ).toBeNull();
  });

  it("prefers the strongest tier when several match", () => {
    expect(
      duplicateReason(
        keys({ business_name: "ABC", city: "Newark", state: "NJ", external_id: "NJ-1", phone: "8625551212" }),
        keys({ business_name: "ABC", city: "Newark", state: "NJ", external_id: "nj-1", phone: "8625551212" })
      )
    ).toBe("external_id");
  });

  it("finds nothing to match on when a row carries only a generic name", () => {
    expect(duplicateReason(keys({ business_name: "Plumbing" }), keys({ business_name: "Plumbing" })))
      .toBeNull();
  });

  it("does not treat two rows with no identifiers as the same business", () => {
    expect(duplicateReason(keys({}), keys({}))).toBeNull();
  });
});

describe("summary wording", () => {
  it("names the identifier that matched", () => {
    expect(describeDuplicateReason("phone")).toBe("Skipped: existing phone match");
    expect(describeDuplicateReason("domain")).toBe("Skipped: existing domain match");
    expect(describeDuplicateReason("email")).toBe("Skipped: existing email match");
    expect(describeDuplicateReason("name_location")).toBe(
      "Skipped: existing name + location match"
    );
    expect(describeDuplicateReason(null)).toBe("Skipped: lead already exists");
  });
});
