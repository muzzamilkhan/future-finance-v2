import { describe, it, expect } from "vitest";
import { parseNumericInput } from "./parseNumericInput";

describe("parseNumericInput", () => {
  it("strips a currency symbol and grouping commas", () => {
    expect(parseNumericInput("$1,445.33")).toBe(1445.33);
  });
  it("strips commas from large amounts", () => {
    expect(parseNumericInput("1,234,567")).toBe(1234567);
  });
  it("leaves a plain number untouched", () => {
    expect(parseNumericInput("450")).toBe(450);
  });
  it("leaves a plain decimal untouched", () => {
    expect(parseNumericInput("19.99")).toBe(19.99);
  });
  it("strips stray letters and spaces", () => {
    expect(parseNumericInput("  NZD 250 ")).toBe(250);
  });
  it("keeps a leading minus sign", () => {
    expect(parseNumericInput("-$50")).toBe(-50);
  });
  it("treats input with no digits as 0 (range then enforced by schema)", () => {
    expect(parseNumericInput("abc")).toBe(0);
  });
});
