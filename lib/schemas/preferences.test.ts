import { describe, it, expect } from "vitest";
import { preferencesInput } from "./preferences";

describe("preferencesInput", () => {
  it("accepts a valid zone and currency", () => {
    expect(preferencesInput.safeParse({ timeZone: "Australia/Sydney", currency: "AUD" }).success)
      .toBe(true);
  });

  it("accepts just one of the two", () => {
    expect(preferencesInput.safeParse({ currency: "USD" }).success).toBe(true);
    expect(preferencesInput.safeParse({ timeZone: "Europe/London" }).success).toBe(true);
  });

  it("rejects an empty object (nothing to update)", () => {
    expect(preferencesInput.safeParse({}).success).toBe(false);
  });

  it("rejects a currency that is not a 3-letter uppercase code", () => {
    expect(preferencesInput.safeParse({ currency: "aud" }).success).toBe(false);
    expect(preferencesInput.safeParse({ currency: "AUDD" }).success).toBe(false);
    expect(preferencesInput.safeParse({ currency: "12" }).success).toBe(false);
  });

  it("rejects a timezone that is not a real IANA zone", () => {
    expect(preferencesInput.safeParse({ timeZone: "Not/AZone" }).success).toBe(false);
    expect(preferencesInput.safeParse({ timeZone: "" }).success).toBe(false);
  });
});
