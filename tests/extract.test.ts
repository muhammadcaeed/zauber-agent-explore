import { describe, it, expect } from "vitest";
import { computeMissingFields } from "../src/steps/extract.js";

describe("computeMissingFields", () => {
  it("returns empty when all required fields are present", () => {
    expect(
      computeMissingFields({
        origin: "Shanghai",
        destination: "Hamburg",
        weightKg: 850,
        mode: "sea",
        customer: null,
        urgency: null,
      })
    ).toEqual([]);
  });

  it("does not flag weightKg: 0 as missing (falsy value bug guard)", () => {
    expect(
      computeMissingFields({
        origin: "Shanghai",
        destination: "Hamburg",
        weightKg: 0,
        mode: "sea",
        customer: null,
        urgency: null,
      })
    ).toEqual([]);
  });

  it("flags null origin", () => {
    const missing = computeMissingFields({
      origin: null,
      destination: "Hamburg",
      weightKg: 100,
      mode: "sea",
      customer: null,
      urgency: null,
    });
    expect(missing).toContain("origin");
    expect(missing).not.toContain("destination");
    expect(missing).not.toContain("weightKg");
  });

  it("flags all four required fields when all null", () => {
    expect(
      computeMissingFields({
        origin: null,
        destination: null,
        weightKg: null,
        mode: null,
        customer: null,
        urgency: null,
      })
    ).toEqual(["origin", "destination", "weightKg", "mode"]);
  });

  it("does not flag optional fields (customer, urgency)", () => {
    const missing = computeMissingFields({
      origin: "Shanghai",
      destination: "Hamburg",
      weightKg: 500,
      mode: "air",
      customer: null,
      urgency: null,
    });
    expect(missing).not.toContain("customer");
    expect(missing).not.toContain("urgency");
  });
});
