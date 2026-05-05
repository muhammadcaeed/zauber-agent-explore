import { describe, it, expect } from "vitest";
import { getCarrierRates } from "../../src/tools/carrierRates.js";

const SEA_REQUEST = {
  origin: "Shanghai",
  destination: "Hamburg",
  weightKg: 500,
  mode: "sea" as const,
};

describe("getCarrierRates", () => {
  it("returns exactly 3 carrier quotes", async () => {
    const rates = await getCarrierRates(SEA_REQUEST);
    expect(rates).toHaveLength(3);
  });

  it("all prices are positive", async () => {
    const rates = await getCarrierRates(SEA_REQUEST);
    expect(rates.every((r) => r.priceEur > 0)).toBe(true);
  });

  it("validUntil is parseable and in the future", async () => {
    const rates = await getCarrierRates(SEA_REQUEST);
    const now = new Date();
    for (const r of rates) {
      const d = new Date(r.validUntil);
      expect(isNaN(d.getTime())).toBe(false);
      expect(d > now).toBe(true);
    }
  });

  it("air freight costs more per kg than sea freight", async () => {
    const [sea, air] = await Promise.all([
      getCarrierRates({ ...SEA_REQUEST, mode: "sea" }),
      getCarrierRates({ ...SEA_REQUEST, mode: "air" }),
    ]);
    const avgSea = sea.reduce((s, r) => s + r.priceEur, 0) / sea.length;
    const avgAir = air.reduce((s, r) => s + r.priceEur, 0) / air.length;
    expect(avgAir).toBeGreaterThan(avgSea);
  });

  it("air transit days are fewer than sea transit days", async () => {
    const [sea, air] = await Promise.all([
      getCarrierRates({ ...SEA_REQUEST, mode: "sea" }),
      getCarrierRates({ ...SEA_REQUEST, mode: "air" }),
    ]);
    const avgSeaDays = sea.reduce((s, r) => s + r.transitDays, 0) / sea.length;
    const avgAirDays = air.reduce((s, r) => s + r.transitDays, 0) / air.length;
    expect(avgAirDays).toBeLessThan(avgSeaDays);
  });

  it("carriers are named consistently", async () => {
    const rates = await getCarrierRates(SEA_REQUEST);
    const names = rates.map((r) => r.carrier);
    expect(names).toContain("Maersk");
    expect(names).toContain("Hapag-Lloyd");
    expect(names).toContain("MSC");
  });
});
