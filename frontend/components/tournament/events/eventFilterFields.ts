import {
  type Assignment,
  EVENT_FORMAT_LABELS,
  EVENT_FORMATS,
  type FilterOptionGroup,
  type FilterOptionItem,
  type TournamentEvent,
  type TournamentShift,
} from "@/lib/api";
import { staffingLines, trackShortfalls } from "@/lib/assignments/staffing";
import type { FilterField } from "@/lib/filters/model";
import { YES_NO_OPTIONS, yesNo } from "@/lib/seasonDefaults";
import { formatTimeRange } from "@/lib/timeFormat";

const TYPE_OPTIONS: FilterOptionItem[] = [
  { value: "standard", label: "Standard" },
  { value: "trial", label: "Trial" },
];

const FORMAT_OPTIONS: FilterOptionItem[] = EVENT_FORMATS.map((format) => ({
  value: format,
  label: EVENT_FORMAT_LABELS[format],
}));

// Not a partition: "Nobody assigned" is a sharper cut of "Short".
const STAFFING_OPTIONS: FilterOptionItem[] = [
  { value: "full", label: "Fully staffed" },
  { value: "short", label: "Short" },
  { value: "empty", label: "Nobody assigned" },
  { value: "no_needs", label: "No needs" },
];

const NEED_OPTIONS: FilterOptionItem[] = [
  { value: "full", label: "Fully staffed" },
  { value: "short", label: "Short" },
  { value: "no_needs", label: "Not needed" },
];

// The Staffing field's group for the event's needs taken together.
const ALL_NEEDS = "all";

const ALL = ["any_of", "none_of", "empty", "not_empty"] as const;
const PICK = ["any_of", "none_of"] as const;
// For what an event can have several of at once: one per track.
const MANY = ["any_of", "all_of", "none_of", "empty", "not_empty"] as const;

export interface EventFilterContext {
  /** Divisions to offer; defaults to the ones the events have. */
  divisions?: string[];
  /** Which tracks are offered for shifts and location, and count for
   *  staffing: all, or the board's tab. */
  showsTrack: (trackId: number) => boolean;
  /** This event's assignments; given, the Staffing field is offered. */
  assignmentsFor?: (eventId: number) => readonly Assignment[];
  /** Off where the page is already one track (a board tab). */
  withTracks?: boolean;
}

function categoryOptions(events: TournamentEvent[]): FilterOptionItem[] {
  const names = new Set(events.flatMap((e) => (e.event ? [e.event.category.name] : [])));
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
}

/** In first-seen (schedule) order. */
function trackOptions(events: TournamentEvent[]): FilterOptionItem[] {
  const seen = new Map<number, string>();
  for (const e of events) for (const t of e.tracks) if (!seen.has(t.id)) seen.set(t.id, t.name);
  return [...seen].map(([id, name]) => ({ value: String(id), label: name }));
}

/** Per track, its shifts, labelled with their times: shift names aren't
 *  unique. */
function shiftGroups(events: TournamentEvent[], tracks: FilterOptionItem[]): FilterOptionGroup[] {
  const shifts = new Map<number, TournamentShift>();
  for (const e of events) for (const s of e.shifts) shifts.set(s.id, s);
  const sorted = [...shifts.values()].sort((a, b) => a.start.localeCompare(b.start));
  return tracks.map((track) => ({
    ...track,
    options: sorted
      .filter((s) => String(s.track_id) === track.value)
      .map((s) => ({ value: String(s.id), label: `${s.label} (${formatTimeRange([s])})` })),
  }));
}

/** Per track, the buildings events are in there, each followed by its rooms
 *  in use. */
function locationGroups(
  events: TournamentEvent[],
  tracks: FilterOptionItem[],
): FilterOptionGroup[] {
  return tracks.map((track) => {
    const buildings = new Map<number, { label: string; rooms: Map<number, string> }>();
    for (const e of events) {
      const detail = e.track_details.find((d) => String(d.track_id) === track.value);
      if (!detail || detail.building_id === null) continue;
      const label =
        detail.building_short_name || detail.building_name || `Building ${detail.building_id}`;
      const building = buildings.get(detail.building_id) ?? { label, rooms: new Map() };
      for (const room of detail.rooms) building.rooms.set(room.id, `${label} ${room.name}`);
      buildings.set(detail.building_id, building);
    }
    const byName = (a: [number, string], b: [number, string]) =>
      a[1].localeCompare(b[1], undefined, { numeric: true });
    return {
      ...track,
      options: [...buildings]
        .sort(([, a], [, b]) => a.label.localeCompare(b.label))
        .flatMap(([id, building]) => [
          { value: `building:${id}`, label: building.label },
          ...[...building.rooms]
            .sort(byName)
            .map(([roomId, name]) => ({ value: `room:${roomId}`, label: name })),
        ]),
    };
  });
}

/** Every role and age rule some event asks for, in the order the events'
 *  needs list them. */
function needGroups(events: TournamentEvent[]): FilterOptionGroup[] {
  const needs = new Map<string, string>();
  for (const e of events) {
    for (const detail of e.track_details) {
      for (const line of staffingLines(detail, [])) {
        if (!needs.has(line.key)) needs.set(line.key, line.label);
      }
    }
  }
  return [
    { value: ALL_NEEDS, label: "All needs", options: STAFFING_OPTIONS },
    ...[...needs].map(([key, label]) => ({ value: key, label, options: NEED_OPTIONS })),
  ];
}

/** One need's answers on the tracks that count: per track, full or short;
 *  not needed when no track asks for it. */
function needValues(
  event: TournamentEvent,
  need: string,
  rows: readonly Assignment[],
  showsTrack: (id: number) => boolean,
): string[] {
  const values = new Set<string>();
  for (const detail of event.track_details) {
    if (!showsTrack(detail.track_id)) continue;
    for (const line of staffingLines(detail, rows)) {
      if (line.key === need) values.add(line.filled >= line.count ? "full" : "short");
    }
  }
  return values.size > 0 ? [...values] : ["no_needs"];
}

/** This event's staffing answers on the tracks that count. */
function staffingValues(
  event: TournamentEvent,
  rows: readonly Assignment[],
  showsTrack: (id: number) => boolean,
): string[] {
  // Every need is its own line, role or age rule: short if any line is.
  let lines = 0;
  let short = false;
  for (const detail of event.track_details) {
    if (!showsTrack(detail.track_id)) continue;
    const { roles, ages } = trackShortfalls(detail, rows);
    lines += roles.length + ages.length;
    if ([...roles, ...ages].some((gap) => gap > 0)) short = true;
  }
  const values = [lines === 0 ? "no_needs" : short ? "short" : "full"];
  if (!rows.some((a) => showsTrack(a.track.id))) values.push("empty");
  return values;
}

/** The event lists' filter fields, matched in the browser, with options
 *  from the loaded events. */
export function eventFilterFields(
  events: TournamentEvent[],
  { divisions, showsTrack, assignmentsFor, withTracks = true }: EventFilterContext,
): FilterField<TournamentEvent>[] {
  const divisionValues =
    divisions ?? [...new Set(events.flatMap((e) => (e.division ? [e.division] : [])))].sort();
  const tracks = trackOptions(events);
  const shownTracks = tracks.filter((track) => showsTrack(Number(track.value)));
  // One track is nothing to choose between, so the per-track fields drop
  // the picker.
  const byTrack = { groupLabel: "Which track", hideSingleGroup: shownTracks.length <= 1 };

  const fields: (FilterField<TournamentEvent> | false)[] = [
    {
      key: "division",
      label: "Division",
      section: "Event",
      ops: ALL,
      control: "divisions",
      options: divisionValues.map((d) => ({ value: d, label: `Division ${d}` })),
      opLabels: { empty: "has no division", not_empty: "has a division" },
      rowValues: (e) => (e.division ? [e.division] : []),
    },
    {
      key: "type",
      label: "Type",
      section: "Event",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: TYPE_OPTIONS,
      rowValues: (e) => [e.event_type],
    },
    {
      key: "format",
      label: "Format",
      section: "Event",
      ops: ALL,
      control: "buttons",
      options: FORMAT_OPTIONS,
      opLabels: { empty: "has no format", not_empty: "has a format" },
      rowValues: (e) => (e.format ? [e.format] : []),
    },
    {
      key: "impound",
      label: "Impound",
      section: "Event",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: YES_NO_OPTIONS,
      rowValues: (e) => [yesNo(e.has_impound)],
    },
    {
      key: "self_schedule",
      label: "Self-schedule",
      section: "Event",
      ops: ["any_of"],
      single: true,
      control: "buttons",
      options: YES_NO_OPTIONS,
      rowValues: (e) => [yesNo(e.has_self_schedule)],
    },
    {
      key: "category",
      label: "Category",
      section: "Event",
      ops: ALL,
      control: "chips",
      options: categoryOptions(events),
      opLabels: { empty: "has no category", not_empty: "has a category" },
      rowValues: (e) => (e.event ? [e.event.category.name] : []),
    },
    withTracks &&
      tracks.length > 1 && {
        key: "track",
        label: "Track",
        section: "Schedule",
        ops: ["any_of", "all_of", "none_of"],
        control: "chips",
        options: tracks,
        opLabels: { any_of: "is on any of", all_of: "is on all of", none_of: "is on none of" },
        rowValues: (e) => e.tracks.map((t) => String(t.id)),
      },
    shownTracks.length > 0 && {
      key: "shift",
      label: "Shift",
      section: "Schedule",
      ops: MANY,
      control: "chips",
      groups: shiftGroups(events, shownTracks),
      ...byTrack,
      opLabels: {
        any_of: "is on any of",
        all_of: "is on all of",
        none_of: "is on none of",
        empty: "has no shifts",
        not_empty: "has shifts",
      },
      rowValues: (e, group) =>
        e.shifts.filter((s) => String(s.track_id) === group).map((s) => String(s.id)),
    },
    // A building, or a room in it; with no building there, the event hasn't
    // been placed on that track.
    shownTracks.length > 0 && {
      key: "location",
      label: "Location",
      section: "Location",
      ops: MANY,
      control: "chips",
      searchable: true,
      groups: locationGroups(events, shownTracks),
      ...byTrack,
      opLabels: {
        any_of: "is in any of",
        all_of: "is in all of",
        none_of: "is in none of",
        empty: "has no location",
        not_empty: "has a location",
      },
      rowValues: (e, group) => {
        const detail = e.track_details.find((d) => String(d.track_id) === group);
        if (!detail || detail.building_id === null) return [];
        return [
          `building:${detail.building_id}`,
          ...detail.room_ids.map((roomId) => `room:${roomId}`),
        ];
      },
    },
    assignmentsFor !== undefined && {
      key: "staffing",
      label: "Staffing",
      section: "Staffing",
      ops: PICK,
      control: "buttons",
      // All needs at once, or one role or age rule.
      groups: needGroups(events),
      groupLabel: "Which need",
      rowValues: (e, group) =>
        group === ALL_NEEDS
          ? staffingValues(e, assignmentsFor(e.id), showsTrack)
          : needValues(e, group ?? "", assignmentsFor(e.id), showsTrack),
    },
  ];
  return fields.filter((field): field is FilterField<TournamentEvent> => field !== false);
}
