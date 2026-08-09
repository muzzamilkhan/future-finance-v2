import { calendarDateInZone } from "./calendarDateInZone";

/**
 * The calendar year it currently is in `timeZone`.
 *
 * Server code must not use `new Date().getFullYear()` for this: that reads the
 * *server's* zone (UTC in production), so for the hours around New Year a user in a
 * positive-offset zone like Australia/Sydney is already in the next year while the
 * server still says the old one — and would import the wrong year's public holidays.
 */
export function currentYearInZone(now: Date, timeZone: string): number {
  // calendarDateInZone returns UTC midnight of the zone's calendar date, so the UTC
  // accessor is the correct one to read the year back off it.
  return calendarDateInZone(now, timeZone).getUTCFullYear();
}
