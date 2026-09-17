import { enumerateDays, parseLocalDate } from "./date";
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
 * The year is appended once at the end when every day falls in the same year,
 * which is the ordinary case. When they don't — a state tournament with a
 * qualifier in September and finals the following April — the year rides on
 * each run instead: "Sep 18, 2026, Apr 10, 2027". Hoisting one year out of a
 * cross-year list silently mislabels every day outside it.
 */
export function formatDates(dates: string[], style: DateStyle = "short"): string | null {
  if (dates.length === 0) return null;
  const options = STYLES[style];
  const runs = runsOf(dates);
  const years = new Set(dates.map((d) => parseLocalDate(d).getFullYear()));
  const sameYear = years.size === 1;

  const fmt = (d: string) => {
    const date = parseLocalDate(d);
    const base = date.toLocaleDateString("en-US", options);
    return sameYear ? base : `${base}, ${date.getFullYear()}`;
  };

  const body = runs
    // A run never spans a year boundary by more than its own endpoints, so
    // both ends carry the year in the mixed case — "Dec 30, 2026 – Jan 2, 2027".
    .map(([start, end]) => (start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`))
    .join(", ");

  return sameYear ? `${body}, ${parseLocalDate(dates[0]).getFullYear()}` : body;
}

/** An inclusive start/end pair, rendered the same way a day list is. */
export function formatDayRange(start: string | null, end: string | null, style: DateStyle = "short"): string | null {
  if (!start || !end || end < start) return null;
  return formatDates(enumerateDays(start, end), style);
}

/** A track's own days, for the per-track rows a multi-site tournament shows. */
export function formatTrackDates(track: TournamentTrack, style: DateStyle = "short"): string | null {
  return formatDayRange(track.start_date, track.end_date, style);
}

/** Where a tournament or track happens — university name wins over free text. */
export function placeOf(entity: { location: string | null; university: { name: string } | null }): string | null {
  return entity.university?.name ?? entity.location ?? null;
}

/**
 * placeOf, but preferring the university's own abbreviation where it has one —
 * for a table cell, where "Caltech" says as much as "California Institute of
 * Technology" and leaves room for the columns beside it. Free-text locations
 * have no short form and come through unchanged.
 */
export function placeOfShort(entity: {
  location: string | null;
  university: { name: string; abbreviation?: string | null } | null;
}): string | null {
  const university = entity.university;
  if (university) return university.abbreviation || university.name;
  return entity.location ?? null;
}

// The tournament `state` field is a full name, and two of its values aren't
// US states at all — California is split into two Science Olympiad regions.
// Anything unlisted falls back to its own first two letters uppercased, so a
// new value degrades to something short rather than blowing out the column.
const STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI",
  Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY",
  "Southern California": "SoCal",
  "Northern California": "NorCal",
};

/** Short form of a tournament's state, for a column too narrow for the name. */
export function stateAbbreviation(state: string): string {
  return STATE_ABBREVIATIONS[state] ?? state.slice(0, 2).toUpperCase();
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
