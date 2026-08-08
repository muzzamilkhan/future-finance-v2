import { describe, it, expect } from "vitest";
import { resolvePreferences } from "./resolve";

describe("resolvePreferences", () => {
  it("applies defaults when nothing is stored", () => {
    expect(resolvePreferences({ timeZone: null, currency: null }))
      .toEqual({ timeZone: "Australia/Sydney", currency: "AUD", locale: "en-AU", isDetected: false });
  });

  it("reports isDetected false when only one column is set", () => {
    expect(resolvePreferences({ timeZone: "America/New_York", currency: null }).isDetected).toBe(false);
  });

  it("uses stored values and derives locale from the zone", () => {
    expect(resolvePreferences({ timeZone: "America/New_York", currency: "USD" }))
      .toEqual({ timeZone: "America/New_York", currency: "USD", locale: "en-US", isDetected: true });
  });

  it("keeps a currency that disagrees with the zone (user's explicit choice wins)", () => {
    const r = resolvePreferences({ timeZone: "Australia/Sydney", currency: "JPY" });
    expect(r.currency).toBe("JPY");
    expect(r.locale).toBe("en-AU");
  });
});
