import { describe, it, expect } from "vitest";
import { debtInputSchema, simulationParamsSchema } from "./debt";

describe("debtInputSchema", () => {
  const valid = { name: "Visa", balance: 5000, apr: 0.1999, minPayment: 150 };

  it("accepts a valid debt", () => {
    expect(debtInputSchema.parse(valid)).toEqual(valid);
  });
  it("trims the name", () => {
    expect(debtInputSchema.parse({ ...valid, name: "  Visa  " }).name).toBe("Visa");
  });
  it("rejects an empty name", () => {
    expect(() => debtInputSchema.parse({ ...valid, name: "   " })).toThrow();
  });
  it("rejects a negative balance", () => {
    expect(() => debtInputSchema.parse({ ...valid, balance: -1 })).toThrow();
  });
  it("rejects apr above 1", () => {
    expect(() => debtInputSchema.parse({ ...valid, apr: 1.5 })).toThrow();
  });
  it("rejects apr below 0", () => {
    expect(() => debtInputSchema.parse({ ...valid, apr: -0.01 })).toThrow();
  });
  it("rejects a negative minPayment", () => {
    expect(() => debtInputSchema.parse({ ...valid, minPayment: -5 })).toThrow();
  });
  it("accepts 0% apr", () => {
    expect(debtInputSchema.parse({ ...valid, apr: 0 }).apr).toBe(0);
  });
});

describe("simulationParamsSchema", () => {
  it("accepts a valid snowball param with no custom order", () => {
    expect(simulationParamsSchema.parse({ strategy: "SNOWBALL", extraPayment: 100 }))
      .toEqual({ strategy: "SNOWBALL", extraPayment: 100 });
  });
  it("accepts a custom order array", () => {
    const r = simulationParamsSchema.parse({ strategy: "CUSTOM", extraPayment: 0, customOrder: ["a", "b"] });
    expect(r.customOrder).toEqual(["a", "b"]);
  });
  it("rejects a negative extraPayment", () => {
    expect(() => simulationParamsSchema.parse({ strategy: "SNOWBALL", extraPayment: -1 })).toThrow();
  });
  it("rejects an unknown strategy", () => {
    expect(() => simulationParamsSchema.parse({ strategy: "TURBO", extraPayment: 0 })).toThrow();
  });
});
