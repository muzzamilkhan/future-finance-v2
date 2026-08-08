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
});
