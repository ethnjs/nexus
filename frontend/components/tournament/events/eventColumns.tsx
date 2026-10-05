"use client";

import { CSSProperties, ReactNode } from "react";
import { Assignment, TournamentEvent, TournamentTrack } from "@/lib/api";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { trackLocationLabel } from "@/lib/eventDisplay";
import { staffedCount } from "@/lib/assignments/staffing";
import { StaffingNeedLine } from "@/components/tournament/assignments/StaffingNeedLine";
import type { EventSortField } from "@/lib/eventSort";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { PENDING_TRACK_NOTE } from "@/components/tournament/PendingTrackBanner";

// Mirrors the backend's DEFAULT_EVENT_COLUMNS — today's fixed table, so the
// feature landing doesn't rearrange anyone's events page.
export const DEFAULT_EVENT_COLUMNS = ["division", "type", "category", "tracks", "shifts"];

// Grid track per kind of data, not per individual column — same rule as the
// roster's WIDTHS. Fixed px where the content has a known maximum (a badge, a
// count), minmax() only where it's open-ended; the min half is what stops a
// narrow window from squeezing a cell until it wraps.
const WIDTHS = {
  // Never narrower than the longest name: the table scrolls sideways instead
  // of truncating the one column a row is found by.
  name: "minmax(max-content, 1.3fr)",
  division: "90px",
  type: "100px",
  category: "minmax(110px, 1.1fr)",
  // Holds a chip per track, and an event on three tracks is normal.
  tracks: "minmax(140px, 1.6fr)",
  // One track's shift labels — usually two or three short words.
  shifts: "minmax(120px, 1.2fr)",
  // A line per day: "Day 1: Sat, Feb 13 10:30 AM – 12:00 PM".
  time: "minmax(260px, 1.6fr)",
  // A building name plus a room or two.
  location: "minmax(130px, 1.2fr)",
  // A ring, role and count per need — two or three needs side by side.
  staffing: "minmax(170px, 1.6fr)",
  // One icon button (delete) — the header stays blank, "Actions" wouldn't fit.
  actions: "40px",
} as const;

const TEXT_CELL: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
  textAlign: "center", display: "block", width: "100%",
};

// Read left-to-right at length, where a centred ellipsis reads badly.
const LEFT_TEXT_CELL: CSSProperties = { ...TEXT_CELL, textAlign: "left" };

const DIVISION_BADGE_VARIANT: Record<string, "divisionA" | "divisionB" | "divisionC"> = {
  A: "divisionA",
  B: "divisionB",
  C: "divisionC",
};

export interface EventColumn {
  key: string;
  label: string;
  /** Grid track for this column, from the WIDTHS table above. */
  width: string;
  /** Columns centre by default; "start" is for values read left-to-right at length, where a centred ellipsis reads badly. */
  align?: "start";
  /** Clicking the header sorts by this field. Only where the column *is* the
   *  field — a per-track column would sort by every track's value, not its own. */
  sortField?: EventSortField;
  render: (event: TournamentEvent) => ReactNode;
}

/** What a per-track cell needs beyond the event itself. Staffing is the
 *  event's assignments against its needs, which the event doesn't carry. */
export interface EventColumnContext {
  /** Every track a family could draw a column for (live ones only). */
  tracks: TournamentTrack[];
  /** This event's assignments. Empty until they load. */
  assignmentsFor: (eventId: number) => readonly Assignment[];
}

// Mirrors EVENT_TRACK_COLUMN_FAMILIES in core/tournament/display_config.py:
// shifts only exist on a dated track and a cosmetic track has no place, so
// those are competition (primary) tracks only; needs go on any.
const TRACK_FAMILIES = {
  shifts: { label: "Shifts", primaryOnly: true },
  location: { label: "Location", primaryOnly: true },
  staffing: { label: "Staffing", primaryOnly: false },
} as const;
type TrackFamily = keyof typeof TRACK_FAMILIES;

const isTrackFamily = (key: string): key is TrackFamily => key in TRACK_FAMILIES;

/** The tracks one family draws a column for, in the order given. */
export function familyTracks(family: string, tracks: readonly TournamentTrack[]): TournamentTrack[] {
  if (!isTrackFamily(family)) return [];
  return tracks.filter((t) => t.is_primary || !TRACK_FAMILIES[family].primaryOnly);
}

/** The family a column key belongs to ("location:3" -> "location"), or null for a scalar column. */
export function trackFamilyOf(key: string): TrackFamily | null {
  const [family, trackId] = key.split(":");
  return trackId !== undefined && isTrackFamily(family) ? family : null;
}

/**
 * Replaces each bare family key ("shifts", "location", ...) with one column
 * per track it applies to, in its place. The bare key is what the defaults
 * and older saved configs hold, and it means "every track" — so it is also
 * how a track added later gets a column without anyone re-saving. Duplicates
 * collapse, so a list naming both the alias and a track doesn't render it twice.
 */
export function expandTrackColumns(keys: readonly string[], tracks: readonly TournamentTrack[]): string[] {
  const out: string[] = [];
  for (const raw of keys) {
    // Time was briefly per track ("time:2"); it's one column now.
    const key = raw.startsWith("time:") ? "time" : raw;
    const expanded = isTrackFamily(key) ? familyTracks(key, tracks).map((t) => `${key}:${t.id}`) : [key];
    for (const k of expanded) if (!out.includes(k)) out.push(k);
  }
  return out;
}

const EMPTY_CELL = (
  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>
);

/** This event's shifts on one track, in schedule order. */
function trackShifts(e: TournamentEvent, track: TournamentTrack) {
  return e.shifts.filter((s) => s.track_id === track.id).sort((a, b) => a.start.localeCompare(b.start));
}

/** One track's cell for one family. */
function renderTrackCell(family: TrackFamily, track: TournamentTrack, e: TournamentEvent, ctx: EventColumnContext): ReactNode {
  switch (family) {
    case "shifts": {
      // A track running several days has same-time shifts on different dates,
      // so the hover names the day too; on a one-day track that is noise.
      const multiDay = !!track.start_date && !!track.end_date && track.start_date !== track.end_date;
      const shifts = trackShifts(e, track);
      if (shifts.length === 0) return EMPTY_CELL;
      return (
        <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
          {shifts.map((s) => {
            const time = `${formatTime(s.start)} – ${formatTime(s.end)}`;
            // Tooltip, not a native title: title waits a second or so and
            // is easy to never see — the app's hover detail everywhere
            // else is this component, and it escapes the cell's clipping.
            return (
              <Tooltip
                key={s.id} variant="info" showIcon={false}
                message={multiDay ? `${formatDayLabel(toDateInput(s.start))} · ${time}` : time}
              >
                <Badge>{s.label}</Badge>
              </Tooltip>
            );
          })}
        </span>
      );
    }
    case "location": {
      const label = trackLocationLabel(e.track_details.find((d) => d.track_id === track.id));
      if (!label) return EMPTY_CELL;
      return <span style={{ ...LEFT_TEXT_CELL, fontFamily: "var(--font-sans)", fontSize: "13px" }} title={label}>{label}</span>;
    }
    case "staffing": {
      const needs = e.track_details.find((d) => d.track_id === track.id)?.needs ?? [];
      if (needs.length === 0) return EMPTY_CELL;
      const rows = ctx.assignmentsFor(e.id);
      return (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", minWidth: 0 }}>
          {needs.map((need) => (
            <StaffingNeedLine key={need.role_id} need={need} filled={staffedCount(rows, need.role_id, track.id)} />
          ))}
        </span>
      );
    }
  }
}

/**
 * When an event runs, a line per day: "Day 1: Sat, Feb 13 9:00 AM – 12:00 PM",
 * first shift's start to last one's end — an event has no times of its own.
 * One column rather than one per track, so a day the event isn't on costs
 * no width. The track name is dropped when there's only one competition track.
 */
function EventTimeLines({ event, tracks }: { event: TournamentEvent; tracks: readonly TournamentTrack[] }) {
  const named = tracks.filter((t) => t.is_primary).length > 1;
  const days = new Map<string, { trackId: number; start: string; end: string }>();
  for (const s of [...event.shifts].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = `${s.track_id}|${toDateInput(s.start)}`;
    const day = days.get(key);
    if (!day) days.set(key, { trackId: s.track_id, start: s.start, end: s.end });
    else if (s.end > day.end) day.end = s.end;
  }
  if (days.size === 0) return EMPTY_CELL;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      {[...days.values()].map((day) => {
        const trackName = tracks.find((t) => t.id === day.trackId)?.name;
        const line = `${formatDayLabel(toDateInput(day.start))} ${formatTime(day.start)} – ${formatTime(day.end)}`;
        return (
          <span key={`${day.trackId}${day.start}`} style={LEFT_TEXT_CELL} title={named && trackName ? `${trackName}: ${line}` : line}>
            {named && trackName && (
              <span style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-tertiary)" }}>{trackName}: </span>
            )}
            {line}
          </span>
        );
      })}
    </span>
  );
}

/** One track's column for one family. */
function trackColumn(key: string, family: TrackFamily, track: TournamentTrack, ctx: EventColumnContext): EventColumn {
  const { label } = TRACK_FAMILIES[family];
  return {
    key,
    // One track in the family: its name is the tournament's, so the bare
    // field name says more than "Main location" would.
    label: familyTracks(family, ctx.tracks).length === 1 ? label : `${track.name} ${label.toLowerCase()}`,
    width: WIDTHS[family],
    align: "start",
    render: (e) => renderTrackCell(family, track, e, ctx),
  };
}

// Every column an event can show. The fixed ones are scalars on the event;
// the per-track families get a column per track (see expandTrackColumns).
function eventColumn(key: string, ctx: EventColumnContext): EventColumn | null {
  const family = trackFamilyOf(key);
  if (family) {
    const track = familyTracks(family, ctx.tracks).find((t) => `${family}:${t.id}` === key);
    // A deleted or demoted track's saved column resolves to nothing rather
    // than an empty column with a stale heading.
    return track ? trackColumn(key, family, track, ctx) : null;
  }
  switch (key) {
    case "division":
      return {
        key, label: "Division", width: WIDTHS.division, sortField: "division",
        render: (e) => (
          <span style={{ display: "flex", justifyContent: "center" }}>
            {e.division
              ? <Badge variant={DIVISION_BADGE_VARIANT[e.division]}>{e.division}</Badge>
              : <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>}
          </span>
        ),
      };
    case "type":
      return {
        key, label: "Type", width: WIDTHS.type,
        render: (e) => (
          <span style={{ display: "flex", justifyContent: "center" }}>
            <Badge variant={e.event_type === "trial" ? "warning" : "default"}>
              {e.event_type === "trial" ? "Trial" : "Standard"}
            </Badge>
          </span>
        ),
      };
    case "time":
      return {
        key, label: "Time", width: WIDTHS.time, align: "start",
        render: (e) => <EventTimeLines event={e} tracks={ctx.tracks} />,
      };
    case "category":
      return {
        key, label: "Category", width: WIDTHS.category, align: "start", sortField: "category",
        render: (e) => {
          const name = e.event?.category.name ?? "";
          return (
            <span style={{
              ...LEFT_TEXT_CELL, fontFamily: "var(--font-sans)", fontSize: "13px",
            }} title={name}>
              {name}
            </span>
          );
        },
      };
    case "tracks":
      // Which parts of the tournament this event belongs to. The days are
      // derivable from its shifts, but they are the same days its track
      // already names — the track is the thing that isn't inferable.
      return {
        key, label: "Tracks", width: WIDTHS.tracks, align: "start",
        render: (e) => (
          <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
            {e.tracks.length > 0
              ? e.tracks.map((t) => (
                  <Badge key={t.id} variant={t.is_archived ? "warning" : "default"} title={t.is_archived ? PENDING_TRACK_NOTE : undefined}>
                    {t.name}
                  </Badge>
                ))
              : <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>}
          </span>
        ),
      };
    default:
      return null;
  }
}

/**
 * Resolves saved column keys into renderable columns, dropping any that no
 * longer resolve — a key saved before a column was removed must not blank out
 * the whole table.
 */
export function resolveEventColumns(keys: string[], ctx: EventColumnContext): EventColumn[] {
  return expandTrackColumns(keys, ctx.tracks)
    .map((key) => eventColumn(key, ctx))
    .filter((column): column is EventColumn => column !== null);
}

export const EVENT_COLUMN_WIDTHS = WIDTHS;
