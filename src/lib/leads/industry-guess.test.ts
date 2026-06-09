import { describe, it, expect } from "vitest";
import { guessIndustryFromName, containsHoldingCoKeywords } from "./industry-guess";

describe("guessIndustryFromName", () => {
  it("maps beauty/salon/spa keywords", () => {
    expect(guessIndustryFromName("ROCKSTAR BEAUTY LLC")).toBe("Beauty / Spa");
    expect(guessIndustryFromName("Glow Nails Salon")).toBe("Beauty / Spa");
    expect(guessIndustryFromName("Pure Skincare Studio")).toBe("Beauty / Spa");
  });

  it("maps HVAC keywords", () => {
    expect(guessIndustryFromName("Atlas HVAC Inc")).toBe("HVAC");
    expect(guessIndustryFromName("Northern Heating and Cooling")).toBe("HVAC");
  });

  it("maps trade keywords", () => {
    expect(guessIndustryFromName("Joe's Plumbing")).toBe("Plumbing");
    expect(guessIndustryFromName("Apex Roofing LLC")).toBe("Roofing");
    expect(guessIndustryFromName("Bright Electric Co")).toBe("Electrical");
  });

  it("maps construction/cleaning/transport/landscaping/auto/childcare/fitness/food", () => {
    expect(guessIndustryFromName("Smith Construction")).toBe("Construction");
    expect(guessIndustryFromName("Citywide Cleaning Services")).toBe("Cleaning");
    expect(guessIndustryFromName("Garden State Trucking")).toBe("Transportation");
    expect(guessIndustryFromName("Greenleaf Landscaping")).toBe("Landscaping");
    expect(guessIndustryFromName("Premier Auto Detailing")).toBe("Automotive");
    expect(guessIndustryFromName("Sunshine Daycare")).toBe("Childcare");
    expect(guessIndustryFromName("Iron Fitness")).toBe("Fitness");
    expect(guessIndustryFromName("Mama's Kitchen")).toBe("Food / Restaurant");
  });

  it("returns null for names with no keyword match", () => {
    expect(guessIndustryFromName("Acme Widgets LLC")).toBeNull();
    expect(guessIndustryFromName("Xyz Corp")).toBeNull();
  });

  it("is case-insensitive and tolerant of punctuation", () => {
    expect(guessIndustryFromName("hvac systems, llc")).toBe("HVAC");
    expect(guessIndustryFromName("HEATING/COOLING-PROS")).toBe("HVAC");
  });

  it("returns null for empty input", () => {
    expect(guessIndustryFromName(null)).toBeNull();
    expect(guessIndustryFromName(undefined)).toBeNull();
    expect(guessIndustryFromName("")).toBeNull();
  });
});

describe("containsHoldingCoKeywords", () => {
  it("flags holding/investments/property/capital/ventures/fund/trust", () => {
    expect(containsHoldingCoKeywords("ACME HOLDINGS LLC")).toBe(true);
    expect(containsHoldingCoKeywords("Smith Holding Co")).toBe(true);
    expect(containsHoldingCoKeywords("Westbrook Property Group")).toBe(true);
    expect(containsHoldingCoKeywords("Tristate Investments LLC")).toBe(true);
    expect(containsHoldingCoKeywords("Bayview Capital Partners")).toBe(true);
    expect(containsHoldingCoKeywords("Liberty Ventures")).toBe(true);
    expect(containsHoldingCoKeywords("Heritage Trust")).toBe(true);
  });

  it("does not flag service-business names with similar substrings", () => {
    // "Beauty" doesn't include holding co keywords; smoke check.
    expect(containsHoldingCoKeywords("Pure Beauty Salon LLC")).toBe(false);
    expect(containsHoldingCoKeywords("Acme Roofing LLC")).toBe(false);
  });
});
