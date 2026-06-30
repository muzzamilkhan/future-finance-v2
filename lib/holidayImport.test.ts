import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchHolidays,
  fetchCountries,
  subdivisionsForCountry,
  filterHolidays,
  type NagerHoliday,
} from "./holidayImport";

const au: NagerHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day", global: true, counties: null },
  { date: "2026-03-02", name: "Labour Day", global: false, counties: ["AU-WA"] },
  { date: "2026-10-05", name: "Labour Day", global: false, counties: ["AU-NSW", "AU-ACT"] },
];

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok, status, json: vi.fn().mockResolvedValue(body),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("filterHolidays", () => {
  it("returns only national holidays when no state given", () => {
    expect(filterHolidays(au)).toEqual([{ name: "New Year's Day", date: "2026-01-01" }]);
  });

  it("includes national + the selected state's holidays only", () => {
    expect(filterHolidays(au, "AU-NSW")).toEqual([
      { name: "New Year's Day", date: "2026-01-01" },
      { name: "Labour Day", date: "2026-10-05" },
    ]);
  });

  it("excludes other states (no same-name collision)", () => {
    const out = filterHolidays(au, "AU-WA");
    expect(out).toEqual([
      { name: "New Year's Day", date: "2026-01-01" },
      { name: "Labour Day", date: "2026-03-02" },
    ]);
  });
});

describe("fetchHolidays", () => {
  it("requests the right URL and parses the array", async () => {
    mockFetchOnce(au);
    const out = await fetchHolidays("AU", 2026);
    expect(fetch).toHaveBeenCalledWith("https://date.nager.at/api/v3/PublicHolidays/2026/AU");
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ name: "New Year's Day", global: true });
  });

  it("throws on a non-200 response", async () => {
    mockFetchOnce({}, false, 404);
    await expect(fetchHolidays("ZZ", 2026)).rejects.toThrow();
  });
});

describe("fetchCountries", () => {
  it("parses the available countries array", async () => {
    mockFetchOnce([{ countryCode: "AU", name: "Australia" }]);
    const out = await fetchCountries();
    expect(out).toEqual([{ countryCode: "AU", name: "Australia" }]);
  });
});

describe("subdivisionsForCountry", () => {
  it("returns sorted distinct county codes", async () => {
    mockFetchOnce(au);
    const out = await subdivisionsForCountry("AU", 2026);
    expect(out).toEqual(["AU-ACT", "AU-NSW", "AU-WA"]);
  });
});
