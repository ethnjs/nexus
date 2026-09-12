"use client";

import { CSSProperties, ReactNode } from "react";
import { TournamentEvent } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { PENDING_TRACK_NOTE } from "@/components/tournament/PendingTrackBanner";

// Mirrors the backend's DEFAULT_EVENT_COLUMNS — today's fixed table, so the
// feature landing doesn't rearrange anyone's events page.
export const DEFAULT_EVENT_COLUMNS = ["division", "type", "category", "tracks", "shifts"];

// The day-of logistics, grouped apart in the config modal: blank through
// most of planning, so they're opt-in rather than five empty columns.
export const LOCATION_COLUMN_KEYS = new Set(["building", "room", "floor", "volunteers_needed"]);

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
  count: "80px",
  // Free text with no known maximum — a building name can be anything.
  text: "minmax(90px, 0.8fr)",
  // Room and floor are short codes ("241", "2nd").
  shortText: "76px",
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

function Dash() {
  return <span style={TEXT_CELL}>—</span>;
}

function textColumn(
  key: string, label: string, width: string,
  value: (e: TournamentEvent) => string | null,
  align?: "start",
): EventColumn {
  const cell = align === "start" ? LEFT_TEXT_CELL : TEXT_CELL;
  return {
    key, label, width, align,
    render: (e: TournamentEvent) => {
      const text = value(e);
      return text ? <span style={cell} title={text}>{text}</span> : <Dash />;
    },
  };
}

// Every column an event can show. Unlike the roster's there are no
// per-entity columns here: a tournament adding a track adds a chip to the
// Tracks cell, not a column of its own.
function eventColumn(key: string): EventColumn | null {
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
    case "shifts":
      return {
        key, label: "Shifts", width: WIDTHS.count,
        render: (e) => (
          <span style={{ ...TEXT_CELL, color: "var(--color-text-tertiary)" }}>{e.shifts.length}</span>
        ),
      };
    case "building":
      return textColumn(key, "Building", WIDTHS.text, (e) => e.building, "start");
    case "room":
      return textColumn(key, "Room", WIDTHS.shortText, (e) => e.room);
    case "floor":
      return textColumn(key, "Floor", WIDTHS.shortText, (e) => e.floor);
    case "volunteers_needed":
      return {
        key, label: "Volunteers", width: WIDTHS.count,
        render: (e) => (
          e.volunteers_needed === null
            ? <Dash />
            : <span style={TEXT_CELL}>{e.volunteers_needed}</span>
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
export function resolveEventColumns(keys: string[]): EventColumn[] {
  return keys
    .map(eventColumn)
    .filter((column): column is EventColumn => column !== null);
}

export const EVENT_COLUMN_WIDTHS = WIDTHS;
