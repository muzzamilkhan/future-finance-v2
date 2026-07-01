import { addWeeks } from "date-fns";
import { ordinal, formatUtcWeekdayLong, formatUtcWeekday } from "@/lib/dateInput";

type Frequency = "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** UTC-midnight of the Monday that starts the Mon-Sun week containing `date`. */
function mondayOfUtcWeek(date: Date): Date {
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon->0, Sun->6
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday,
  ));
}

/** First fortnightly occurrence on/after `today`, stepping 2 weeks from `start`. */
function nextFortnightly(start: Date, today: Date): Date {
  let occ = start;
  while (occ.getTime() < today.getTime()) occ = addWeeks(occ, 2);
  return occ;
}

/**
 * Human-readable recurrence label. `today` is a UTC-anchored date, passed in —
 * never read from the clock. All date fields read via UTC accessors.
 */
export function frequencyLabel(
  p: { frequency: Frequency; startDate: Date },
  today: Date,
): string {
  const s = p.startDate;
  const day = ordinal(s.getUTCDate());
  const month = SHORT_MONTHS[s.getUTCMonth()];

  switch (p.frequency) {
    case "MONTHLY":
      return `Every ${day}`;
    case "WEEKLY":
      return `Every ${formatUtcWeekdayLong(s)}`;
    case "ANNUAL":
      return `Every ${day} ${month}`;
    case "ONCE_OFF":
      return `${day} ${month}, ${s.getUTCFullYear()}`;
    case "FORTNIGHTLY": {
      const weekday = formatUtcWeekday(s); // "Tue"
      const occ = nextFortnightly(s, today);
      const thisWeek = mondayOfUtcWeek(today);
      const nextWeek = addWeeks(thisWeek, 1);
      const occWeek = mondayOfUtcWeek(occ);
      if (occWeek.getTime() === thisWeek.getTime()) return `This ${weekday}`;
      if (occWeek.getTime() === nextWeek.getTime()) return `Next ${weekday}`;
      return `Every other ${weekday}`;
    }
  }
}
