import { describe, it, expect } from "vitest";
import { buildConversationText } from "../src/steps/clarify.js";

describe("buildConversationText", () => {
  it("returns only email when no Q&A", () => {
    expect(buildConversationText("Ship 100kg to Hamburg", [], [])).toBe(
      "Ship 100kg to Hamburg"
    );
  });

  it("appends one Q&A pair", () => {
    const result = buildConversationText("Ship stuff to Hamburg", ["Weight?"], ["500kg"]);
    expect(result).toBe("Ship stuff to Hamburg\n\nQuestion: Weight?\nAnswer: 500kg");
  });

  it("appends multiple Q&A pairs in order", () => {
    const result = buildConversationText(
      "Ship to Hamburg",
      ["Origin?", "Mode?"],
      ["Shanghai", "Sea"]
    );
    expect(result).toBe(
      "Ship to Hamburg\n\nQuestion: Origin?\nAnswer: Shanghai\n\nQuestion: Mode?\nAnswer: Sea"
    );
  });

  it("handles partial replies — no reply for last question", () => {
    const result = buildConversationText("Ship to Hamburg", ["Origin?"], []);
    expect(result).toBe("Ship to Hamburg\n\nQuestion: Origin?\nAnswer: ");
  });
});
