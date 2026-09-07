import { describe, expect, it } from "vitest";
import { centsToInput, costToCents, formatEuros, parseEuros } from "@/lib/money";

describe("formatEuros", () => {
  it("formats cents the French way", () => {
    expect(formatEuros(1250)).toBe("12,50 €");
    expect(formatEuros(0)).toBe("0,00 €");
    expect(formatEuros(5)).toBe("0,05 €");
  });
});

describe("centsToInput", () => {
  it("drops trailing zero cents", () => {
    expect(centsToInput(2000)).toBe("20");
    expect(centsToInput(1250)).toBe("12.50");
  });
});

describe("parseEuros", () => {
  it("accepts a comma or a dot, and a stray symbol", () => {
    expect(parseEuros("12,50")).toBe(1250);
    expect(parseEuros("12.5")).toBe(1250);
    expect(parseEuros("20 €")).toBe(2000);
  });

  it("rejects what is not a usable amount", () => {
    expect(parseEuros("")).toBeNull();
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("-3")).toBeNull();
  });
});

describe("costToCents", () => {
  it("keeps a centime amount as cents and converts a real currency", () => {
    expect(costToCents("1250", "centime")).toBe(1250);
    expect(costToCents("12.5", "EUR")).toBe(1250);
  });

  it("returns null for an absent or unusable value", () => {
    expect(costToCents(undefined, "centime")).toBeNull();
    expect(costToCents("", "centime")).toBeNull();
    expect(costToCents("n/a", "centime")).toBeNull();
  });
});
