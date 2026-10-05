"use client";

import { CSSProperties, ReactNode } from "react";
import { Assignment, TournamentDivision, TournamentEvent, TournamentTrack } from "@/lib/api";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";
import { eventName, trackLocationLabel } from "@/lib/eventDisplay";
import { staffedCount } from "@/lib/assignments/staffing";
import { StaffingNeedLine } from "@/components/tournament/assignments/StaffingNeedLine";
import type { EventSortField } from "@/lib/eventSort";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { PENDING_TRACK_NOTE } from "@/components/tournament/PendingTrackBanner";
import { ChipsCell, EventEditContext, LocationCell, SelectCell, StaffingCell } from "@/components/tournament/events/EditableCells";
import { toTrackDetailInput, withTrackDetail } from "@/lib/eventTrackDetails";

// Mirrors the backend's DEFAULT_EVENT_COLUMNS — what the table shows until a
// viewer saves their own, and what Reset returns to.
export const DEFAULT_EVENT_COLUMNS = ["division", "type", "category", "tracks", "time"];

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
  // Never truncated, like name — the table scrolls sideways instead.
  category: "minmax(max-content, 1.1fr)",
  // Holds a chip per track, and an event on three tracks is normal.
  tracks: "minmax(220px, 2fr)",
  // One track's shift labels — usually two or three short words.
  shifts: "minmax(120px, 1.2fr)",
  // A line per day: "Day 1: Sat, Feb 13 10:30 AM – 12:00 PM".
  time: "minmax(260px, 1.6fr)",
  // A building name plus room chips, all editable in place.
  location: "minmax(220px, 1.6fr)",
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
  /** `lockReason` comes from the row, which knows whether its event is open
   *  in the panel — undefined means editable. */
  render: (event: TournamentEvent, lockReason?: string) => ReactNode;
}

/** What a per-track cell needs beyond the event itself. Staffing is the
 *  event's assignments against its needs, which the event doesn't carry. */
export interface EventColumnContext {
  /** Every track a family could draw a column for (live ones only). */
  tracks: TournamentTrack[];
  /** This event's assignments. Empty until they load. */
  assignmentsFor: (eventId: number) => readonly Assignment[];
  /** Given, editable columns edit in place. */
  edit?: EventEditContext;
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

// An absent value worth naming ("No location"), muted like the editable
// cells' own placeholders so locked and editable rows read the same.
const noValue = (text: string) => (
  <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{text}</span>
);

const EMPTY_CELL = (
  <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>
);

/** This event's shifts on one track, in schedule order. */
function trackShifts(e: TournamentEvent, track: TournamentTrack) {
  return e.shifts.filter((s) => s.track_id === track.id).sort((a, b) => a.start.localeCompare(b.start));
}

/** One track's cell for one family. */
function renderTrackCell(
  family: TrackFamily, track: TournamentTrack, e: TournamentEvent, ctx: EventColumnContext, lockReason?: string,
): ReactNode {
  switch (family) {
    case "shifts": {
      // A track running several days has same-time shifts on different dates,
      // so the hover names the day too; on a one-day track that is noise.
      const multiDay = !!track.start_date && !!track.end_date && track.start_date !== track.end_date;
      const shifts = trackShifts(e, track);
      const shiftTime = (s: { start: string; end: string }) => {
        const time = `${formatTime(s.start)} – ${formatTime(s.end)}`;
        return multiDay ? `${formatDayLabel(toDateInput(s.start))} · ${time}` : time;
      };
      const display = shifts.length === 0 ? EMPTY_CELL : (
        <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
          {/* Tooltip, not a native title: title waits a second or so and is
              easy to never see — the app's hover detail everywhere else is
              this component, and it escapes the cell's clipping. */}
          {shifts.map((s) => (
            <Tooltip key={s.id} variant="info" showIcon={false} message={shiftTime(s)}>
              <Badge>{s.label}</Badge>
            </Tooltip>
          ))}
        </span>
      );
      if (!ctx.edit) return display;
      const { edit } = ctx;
      const current = e.shifts.map((s) => s.id);
      return (
        <ChipsCell
          display={display}
          selected={shifts}
          all={edit.shifts.filter((s) => s.track_id === track.id).sort((a, b) => a.start.localeCompare(b.start))}
          getKey={(s) => s.id}
          getLabel={(s) => s.label}
          getTooltip={shiftTime}
          lockReason={lockReason}
          onAdd={(s) => edit.update(e, { shift_ids: [...current, s.id] })}
          onRemove={(s) => edit.update(e, { shift_ids: current.filter((id) => id !== s.id) })}
          addTitle={`Edit ${track.name} shifts`}
          emptyMessage="No shifts on this track yet."
        />
      );
    }
    case "location": {
      const detail = e.track_details.find((d) => d.track_id === track.id);
      const label = trackLocationLabel(detail);
      const display = label
        ? <span style={{ ...LEFT_TEXT_CELL, fontFamily: "var(--font-sans)", fontSize: "13px" }} title={label}>{label}</span>
        : noValue("No location");
      if (!ctx.edit) return display;
      const { edit } = ctx;
      return (
        <LocationCell
          display={display}
          detail={detail}
          trackId={track.id}
          buildings={edit.buildings}
          lockReason={lockReason}
          // Joins the track if the event isn't on it yet (withTrackDetail adds it).
          onSave={(updates) => edit.update(e, { track_details: withTrackDetail(e, track.id, updates) })}
          ensureBuilding={edit.ensureBuilding}
        />
      );
    }
    case "staffing": {
      const needs = e.track_details.find((d) => d.track_id === track.id)?.needs ?? [];
      const rows = ctx.assignmentsFor(e.id);
      const display = needs.length === 0 ? noValue("No staffing") : (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", minWidth: 0 }}>
          {needs.map((need) => (
            <StaffingNeedLine key={need.role_id} need={need} filled={staffedCount(rows, need.role_id, track.id)} />
          ))}
        </span>
      );
      if (!ctx.edit) return display;
      const { edit } = ctx;
      return (
        <StaffingCell
          display={display}
          needs={needs}
          roles={edit.roles}
          lockReason={lockReason}
          // Joins the track if the event isn't on it yet (withTrackDetail adds it).
          onSave={(next) => edit.update(e, { track_details: withTrackDetail(e, track.id, { needs: next }) })}
        />
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
    render: (e, lockReason) => renderTrackCell(family, track, e, ctx, lockReason),
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
        render: (e, lockReason) => {
          const display = e.division
            ? <Badge variant={DIVISION_BADGE_VARIANT[e.division]}>{e.division}</Badge>
            : <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>;
          if (!ctx.edit) return <span style={{ display: "flex", justifyContent: "center" }}>{display}</span>;
          const { edit } = ctx;
          return (
            <span style={{ display: "flex", justifyContent: "center" }}>
              <SelectCell
                display={display}
                value={e.division ?? ""}
                options={[...edit.divisions.map((d) => ({ value: d, label: d })), { value: "", label: "None" }]}
                lockReason={lockReason}
                divisions
                onPick={(division) => edit.update(e, { division: (division || null) as TournamentDivision | null })}
              />
            </span>
          );
        },
      };
    case "type":
      return {
        key, label: "Type", width: WIDTHS.type,
        render: (e, lockReason) => {
          const display = (
            <Badge variant={e.event_type === "trial" ? "warning" : "default"}>
              {e.event_type === "trial" ? "Trial" : "Standard"}
            </Badge>
          );
          if (!ctx.edit) return <span style={{ display: "flex", justifyContent: "center" }}>{display}</span>;
          const { edit } = ctx;
          return (
            <span style={{ display: "flex", justifyContent: "center" }}>
              <SelectCell
                display={display}
                value={e.event_type}
                options={[{ value: "standard", label: "Standard" }, { value: "trial", label: "Trial" }]}
                lockReason={lockReason}
                onPick={(event_type) => edit.update(e, { event_type: event_type as TournamentEvent["event_type"] })}
              />
            </span>
          );
        },
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
        render: (e, lockReason) => {
          const display = (
            <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
              {e.tracks.length > 0
                ? e.tracks.map((t) => (
                    <Badge key={t.id} variant={t.is_archived ? "warning" : "default"} title={t.is_archived ? PENDING_TRACK_NOTE : undefined}>
                      {t.name}
                    </Badge>
                  ))
                : EMPTY_CELL}
            </span>
          );
          if (!ctx.edit) return display;
          const { edit } = ctx;
          // Removing a track drops its location and needs; with shifts still
          // on it, those go too (the server won't unlink a track a shift sits
          // on), so that case asks first.
          const removeTrack = (t: TournamentTrack) => {
            const save = () => edit.update(e, {
              shift_ids: e.shifts.filter((s) => s.track_id !== t.id).map((s) => s.id),
              track_details: e.track_details.filter((d) => d.track_id !== t.id).map(toTrackDetailInput),
            });
            const onTrack = e.shifts.filter((s) => s.track_id === t.id).length;
            if (onTrack === 0) return save();
            edit.confirm({
              title: `Remove ${t.name}?`,
              description: `This also removes ${onTrack} shift${onTrack === 1 ? "" : "s"} on ${t.name} from ${eventName(e)}. Anyone assigned to those shifts stays assigned, just without a shift.`,
              confirmLabel: "Remove track and shifts",
              onConfirm: save,
            });
            return Promise.resolve();
          };
          return (
            <ChipsCell
              display={display}
              selected={e.tracks}
              // Live tracks to add, plus any pending-delete one the event still
              // holds — it can be removed but not newly added.
              all={[...ctx.tracks, ...e.tracks.filter((t) => t.is_archived)]}
              getKey={(t) => t.id}
              getLabel={(t) => t.name}
              getStatus={(t) => (t.is_archived ? "warning" : "default")}
              getTooltip={(t) => (t.is_archived ? PENDING_TRACK_NOTE : undefined)}
              lockReason={lockReason}
              onAdd={(t) => edit.update(e, { track_details: withTrackDetail(e, t.id, {}) })}
              onRemove={removeTrack}
              addTitle="Edit tracks"
              emptyMessage="No tracks yet."
            />
          );
        },
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
