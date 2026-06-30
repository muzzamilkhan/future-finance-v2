import { z } from "zod";

const BASE = "https://date.nager.at/api/v3";

const nagerHolidaySchema = z.object({
  date: z.string(),
  name: z.string(),
  global: z.boolean(),
  counties: z.array(z.string()).nullable(),
});
const nagerHolidaysSchema = z.array(nagerHolidaySchema);

const countriesSchema = z.array(z.object({
  countryCode: z.string(),
  name: z.string(),
}));

export type NagerHoliday = z.infer<typeof nagerHolidaySchema>;
export type ImportedHoliday = { name: string; date: string };

export async function fetchHolidays(countryCode: string, year: number): Promise<NagerHoliday[]> {
  const res = await fetch(`${BASE}/PublicHolidays/${year}/${countryCode}`);
  if (!res.ok) throw new Error(`Failed to fetch holidays for ${countryCode} (${res.status})`);
  return nagerHolidaysSchema.parse(await res.json());
}

export async function fetchCountries(): Promise<{ countryCode: string; name: string }[]> {
  const res = await fetch(`${BASE}/AvailableCountries`);
  if (!res.ok) throw new Error(`Failed to fetch countries (${res.status})`);
  return countriesSchema.parse(await res.json());
}

export function filterHolidays(holidays: NagerHoliday[], stateCode?: string): ImportedHoliday[] {
  return holidays
    .filter((h) => h.global || (!!stateCode && (h.counties ?? []).includes(stateCode)))
    .map((h) => ({ name: h.name, date: h.date }));
}

export async function subdivisionsForCountry(countryCode: string, year: number): Promise<string[]> {
  const holidays = await fetchHolidays(countryCode, year);
  const codes = new Set<string>();
  for (const h of holidays) for (const c of h.counties ?? []) codes.add(c);
  return [...codes].sort();
}
