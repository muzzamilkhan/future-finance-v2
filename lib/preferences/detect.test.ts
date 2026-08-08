import { describe, it, expect } from "vitest";
import { detectFromResolvedOptions } from "./detect";

describe("detectFromResolvedOptions", () => {
  it("uses the IANA zone verbatim and derives currency from the locale region", () => {
    expect(detectFromResolvedOptions({ timeZone: "Australia/Sydney", locale: "en-AU" }))
      .toEqual({ timeZone: "Australia/Sydney", currency: "AUD" });
  });

  it("handles a US browser", () => {
    expect(detectFromResolvedOptions({ timeZone: "America/New_York", locale: "en-US" }))
      .toEqual({ timeZone: "America/New_York", currency: "USD" });
  });

  it("reads the region from a script-tagged locale", () => {
    expect(detectFromResolvedOptions({ timeZone: "Asia/Shanghai", locale: "zh-Hans-CN" }).currency)
      .toBe("CNY");
  });

  it("falls back to the default currency when the locale has no region", () => {
    expect(detectFromResolvedOptions({ timeZone: "Europe/London", locale: "en" }))
      .toEqual({ timeZone: "Europe/London", currency: "AUD" });
  });

  it("falls back to the default zone when the browser reports nothing", () => {
    expect(detectFromResolvedOptions({}))
      .toEqual({ timeZone: "Australia/Sydney", currency: "AUD" });
  });
});
