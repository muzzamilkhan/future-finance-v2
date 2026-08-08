import { describe, it, expect } from "vitest";
import { localeForZone } from "./localeForZone";

describe("localeForZone", () => {
  it("maps Australian zones to en-AU", () => {
    expect(localeForZone("Australia/Sydney")).toBe("en-AU");
    expect(localeForZone("Australia/Perth")).toBe("en-AU");
  });

  it("maps US zones to en-US", () => {
    expect(localeForZone("America/New_York")).toBe("en-US");
    expect(localeForZone("America/Los_Angeles")).toBe("en-US");
  });

  it("maps other known regions", () => {
    expect(localeForZone("Pacific/Auckland")).toBe("en-NZ");
    expect(localeForZone("Europe/London")).toBe("en-GB");
  });

  it("falls back to the default locale for unknown zones", () => {
    expect(localeForZone("Not/AZone")).toBe("en-AU");
    expect(localeForZone("")).toBe("en-AU");
  });

  it("overrides US zones under the Pacific/ IANA prefix", () => {
    expect(localeForZone("Pacific/Honolulu")).toBe("en-US");
    expect(localeForZone("Pacific/Guam")).toBe("en-US");
    expect(localeForZone("Pacific/Pago_Pago")).toBe("en-US");
  });

  it("overrides Canadian zones under the America/ IANA prefix", () => {
    expect(localeForZone("America/Toronto")).toBe("en-CA");
    expect(localeForZone("America/Vancouver")).toBe("en-CA");
  });

  it("still falls through to the prefix default for other zones in those namespaces", () => {
    expect(localeForZone("Pacific/Fiji")).toBe("en-AU");
    expect(localeForZone("America/New_York")).toBe("en-US");
  });
});
