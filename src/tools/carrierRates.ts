export type RateRequest = {
  origin: string;
  destination: string;
  weightKg: number;
  mode: "sea" | "air" | "road";
};

export type RateQuote = {
  carrier: string;
  transitDays: number;
  priceEur: number;
  validUntil: string;
};

// Fake but plausible. Three carriers, deterministic-ish pricing.
export async function getCarrierRates(req: RateRequest): Promise<RateQuote[]> {
  // Simulate API latency. Real carriers are slow.
  await new Promise((r) => setTimeout(r, 300));

  const baseRatePerKg = req.mode === "air" ? 4.5 : req.mode === "road" ? 1.2 : 0.8;
  const transit = req.mode === "air" ? 3 : req.mode === "road" ? 7 : 32;
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0] ?? "";

  const carriers = ["Maersk", "Hapag-Lloyd", "MSC"];
  return carriers.map((carrier, i) => ({
    carrier,
    transitDays: transit + i,
    priceEur: Math.round(req.weightKg * baseRatePerKg * (0.95 + i * 0.05) * 100) / 100,
    validUntil
  }));
}

// Tool schema for Claude tool use. Match this shape exactly.
export const carrierRatesTool = {
  name: "get_carrier_rates",
  description:
    "Get rate quotes from multiple ocean/air/road carriers for a shipment. Returns a list of carrier offers with price, transit time, and validity.",
  input_schema: {
    type: "object" as const,
    properties: {
      origin: { type: "string", description: "Origin port or city, e.g. 'Shanghai'" },
      destination: { type: "string", description: "Destination port or city, e.g. 'Hamburg'" },
      weightKg: { type: "number", description: "Total shipment weight in kilograms" },
      mode: {
        type: "string",
        enum: ["sea", "air", "road"],
        description: "Transport mode"
      }
    },
    required: ["origin", "destination", "weightKg", "mode"]
  }
};