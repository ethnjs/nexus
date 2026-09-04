// Returns today's date in the local timezone as YYYY-MM-DD, suitable for
// <input type="date"> min/max attributes (which are timezone-naive).
export function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Parses a "YYYY-MM-DD" date-only string (e.g. a day from Tournament.dates)
// into a local-time Date. new Date(d) instead reads the string as UTC
// midnight, which shifts to the previous day in negative-UTC-offset
// timezones — splitting and constructing a local Date avoids that.
export function parseLocalDate(d: string): Date {
  const [year, month, day] = d.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Every day in [start, end] inclusive, as YYYY-MM-DD strings. A tournament
// has no such range — its `dates` are already the list of days it runs — but
// a *track* does: a competition day carries a real contiguous start/end, and
// its shifts have to land inside it.
export function enumerateDays(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = parseLocalDate(start);
  const last = parseLocalDate(end);
  while (cursor <= last) {
    days.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
