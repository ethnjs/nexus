"use client";

import { CSSProperties, ReactNode } from "react";
import { TournamentEvent, TournamentTrack } from "@/lib/api";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { PENDING_TRACK_NOTE } from "@/components/tournament/PendingTrackBanner";

// Mirrors the backend's DEFAULT_EVENT_COLUMNS — today's fixed table, so the
// feature landing doesn't rearrange anyone's events page.
export const DEFAULT_EVENT_COLUMNS = ["division", "type", "category", "tracks", "shifts"];

// No location or staffing columns: both are per track now (#81), and a table
// row is per event — an event on two days holds two buildings, and there is
// no single value to print. They live on the event panel and the buildings
// page instead.

// Grid track per kind of data, not per individual column — same rule as the
// roster's WIDTHS. Fixed px where the content has a known maximum (a badge, a
// count), minmax() only where it's open-ended; the min half is what stops a
// narrow window from squeezing a cell until it wraps.
const WIDTHS = {
  name: "minmax(150px, 1.3fr)",
  division: "90px",
  type: "100px",
  category: "minmax(110px, 1.1fr)",
  // Holds a chip per track, and an event on three tracks is normal.
  tracks: "minmax(140px, 1.6fr)",
  // One track's shift labels — usually two or three short words.
  shifts: "minmax(120px, 1.2fr)",
  actions: "70px",
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
  render: (event: TournamentEvent) => ReactNode;
}

// Mirrors EVENT_SHIFTS_NAMESPACE in core/tournament/display_config.py.
const SHIFT_COLUMN_PREFIX = "shifts:";

/**
 * Replaces the bare "shifts" key with one column per competition track, in
 * its place. The bare key is what the defaults and any config saved before
 * the split hold, and it means "every track" — so it is also how a track
 * added later gets a column without anyone re-saving. Duplicates collapse,
 * so a list naming both the alias and a track doesn't render it twice.
 */
export function expandShiftColumns(keys: readonly string[], trackIds: readonly number[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const expanded = key === "shifts" ? trackIds.map((id) => `${SHIFT_COLUMN_PREFIX}${id}`) : [key];
    for (const k of expanded) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** One competition track's shifts, as chips with their time on hover. */
function shiftColumn(key: string, track: TournamentTrack, onlyTrack: boolean): EventColumn {
  // A track running several days has same-time shifts on different dates,
  // so the hover names the day too; on a one-day track that is noise.
  const multiDay = !!track.start_date && !!track.end_date && track.start_date !== track.end_date;
  return {
    key,
    // One competition track: its name is the tournament's, so "Shifts" says
    // more than "Main" would.
    label: onlyTrack ? "Shifts" : track.name,
    width: WIDTHS.shifts,
    align: "start",
    render: (e) => {
      const shifts = e.shifts
        .filter((s) => s.track_id === track.id)
        .sort((a, b) => a.start.localeCompare(b.start));
      return (
        <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
          {shifts.length > 0
            ? shifts.map((s) => {
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
              })
            : <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>}
        </span>
      );
    },
  };
}

// Every column an event can show. The fixed ones are scalars on the event;
// the one per-entity family is shifts, a column per competition track (see
// expandShiftColumns).
function eventColumn(key: string, competitionTracks: TournamentTrack[]): EventColumn | null {
  if (key.startsWith(SHIFT_COLUMN_PREFIX)) {
    const track = competitionTracks.find((t) => `${SHIFT_COLUMN_PREFIX}${t.id}` === key);
    // A deleted or demoted track's saved column resolves to nothing rather
    // than an empty column with a stale heading.
    return track ? shiftColumn(key, track, competitionTracks.length === 1) : null;
  }
  switch (key) {
    case "division":
      return {
        key, label: "Division", width: WIDTHS.division,
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
    case "category":
      return {
        key, label: "Category", width: WIDTHS.category, align: "start",
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
export function resolveEventColumns(keys: string[], competitionTracks: TournamentTrack[]): EventColumn[] {
  return expandShiftColumns(keys, competitionTracks.map((t) => t.id))
    .map((key) => eventColumn(key, competitionTracks))
    .filter((column): column is EventColumn => column !== null);
}

export const EVENT_COLUMN_WIDTHS = WIDTHS;
