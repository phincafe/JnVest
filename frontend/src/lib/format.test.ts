import { describe, expect, it } from "vitest";
import { changeClass, fmtChange, fmtPct, fmtPrice } from "./format";

describe("format", () => {
  it("fmtPrice formats with default 2 digits", () => {
    expect(fmtPrice(1234.5)).toBe("1,234.50");
    expect(fmtPrice(null)).toBe("—");
  });

  it("fmtChange shows sign for positive", () => {
    expect(fmtChange(1.23)).toBe("+1.23");
    expect(fmtChange(-1.23)).toBe("-1.23");
    expect(fmtChange(0)).toBe("+0.00");
  });

  it("fmtPct formats percentage with sign", () => {
    expect(fmtPct(2.5)).toBe("+2.50%");
    expect(fmtPct(-2.5)).toBe("-2.50%");
  });

  it("changeClass maps direction", () => {
    expect(changeClass(1)).toContain("up");
    expect(changeClass(-1)).toContain("down");
    expect(changeClass(0)).toContain("dim");
  });
});
