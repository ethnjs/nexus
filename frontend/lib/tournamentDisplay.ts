import { parseLocalDate } from "./date";
import type { TournamentPublic, TournamentTrack } from "./api";

// A tournament's `dates` is the list of days it actually runs, not a range —
// Day 1 on Feb 13 and Day 2 on Feb 20 runs on two days, and rendering
// "Feb 13 – Feb 20" would claim the six between them. So consecutive days
// collapse into a run and gaps stay separate: "Feb 13 – 14" but
// "Feb 13, Feb 20".

type DateStyle = "short" | "long" | "weekday";

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short:   { month: "short", day: "numeric" },
  long:    { month: "long", day: "numeric" },
  weekday: { weekday: "long", month: "long", day: "numeric" },
};

function isNextDay(a: string, b: string): boolean {
  const next = parseLocalDate(a);
  next.setDate(next.getDate() + 1);
  return next.getTime() === parseLocalDate(b).getTime();
}

/** Consecutive runs of days, each as a [start, end] pair of YYYY-MM-DD. */
function runsOf(dates: string[]): [string, string][] {
  const sorted = [...dates].sort();
  const runs: [string, string][] = [];
  for (const date of sorted) {
    const last = runs[runs.length - 1];
    if (last && isNextDay(last[1], date)) last[1] = date;
    else runs.push([date, date]);
  }
  return runs;
}

/**
 * Human-readable form of a tournament's (or track's) days. Null when there
 * are none — a cosmetic track has no dates at all.
 *
 * The year is appended once at the end rather than repeated per run, since
 * every day of one tournament is realistically in the same year.
 */
export function formatDates(dates: string[], style: DateStyle = "short"): string | null {
  if (dates.length === 0) return null;
  const options = STYLES[style];
  const fmt = (d: string) => parseLocalDate(d).toLocaleDateString("en-US", options);
  const body = runsOf(dates)
    .map(([start, end]) => (start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`))
    .join(", ");
  return `${body}, ${parseLocalDate(dates[0]).getFullYear()}`;
}

/** An inclusive start/end pair, rendered the same way a day list is. */
export function formatDayRange(start: string | null, end: string | null, style: DateStyle = "short"): string | null {
  if (!start || !end || end < start) return null;
  const days: string[] = [];
  const cursor = parseLocalDate(start);
  const last = parseLocalDate(end);
  while (cursor <= last) {
    days.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return formatDates(days, style);
}

/** A track's own days, for the per-track rows a multi-site tournament shows. */
export function formatTrackDates(track: TournamentTrack, style: DateStyle = "short"): string | null {
  return formatDayRange(track.start_date, track.end_date, style);
}

/** Where a tournament or track happens — university name wins over free text. */
export function placeOf(entity: { location: string | null; university: { name: string } | null }): string | null {
  return entity.university?.name ?? entity.location ?? null;
}

/** The year a tournament runs in, or null before it has any dates. */
export function tournamentYear(t: Pick<TournamentPublic, "dates">): number | null {
  return t.dates.length > 0 ? parseLocalDate(t.dates[0]).getFullYear() : null;
}

/** "2027 SoCal Regional" — short_name where the TD set one. */
export function tournamentDisplayName(t: Pick<TournamentPublic, "dates" | "name" | "short_name">): string {
  const year = tournamentYear(t);
  const name = t.short_name || t.name;
  return year ? `${year} ${name}` : name;
}

/**
 * The primary tracks — the ones carrying real dates and a venue.
 *
 * With exactly one, a tournament's own `location`/`dates` resolve and the
 * header renders the classic single line. With more than one there is no
 * single answer (the backend leaves `location` null), so callers render one
 * row per track instead. Cosmetic tracks never take part in either.
 */
export function primaryTracks(t: Pick<TournamentPublic, "tracks">): TournamentTrack[] {
  return t.tracks.filter((track) => track.is_primary);
}

/** One "where and when" line to render. */
export interface TournamentFactRow {
  key:   string | number
  /** The track's name — set only when there is more than one primary track. */
  name:  string | null
  place: string | null
  dates: string | null
}

/**
 * What a header or card should show for where/when. One row for the ordinary
 * single-site tournament, one per primary track for a regional running two
 * venues — which is the only honest rendering, since the tournament's own
 * location resolves to null in that case.
 */
export function tournamentFactRows(
  t: Pick<TournamentPublic, "dates" | "location" | "university" | "tracks">,
  style: DateStyle = "short",
): TournamentFactRow[] {
  const primary = primaryTracks(t);
  if (primary.length > 1) {
    return primary.map((track) => ({
      key: track.id,
      name: track.name,
      place: placeOf(track),
      dates: formatTrackDates(track, style),
    }));
  }
  return [{ key: "tournament", name: null, place: placeOf(t), dates: formatDates(t.dates, style) }];
}
