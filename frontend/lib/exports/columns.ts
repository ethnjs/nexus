import type {
  Assignment, DisplayConfigCatalog, ExportColumnMode, ExportRowType, MembershipField,
  MembershipFull, TournamentEventMember,
} from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import {
  AVAILABILITY_TRACK_PREFIX, EVENT_PREF_PREFIX, FORM_FIELD_PREFIX, LUNCH_PREFIX, TRACK_PREFIX,
} from "@/lib/memberColumnKeys";
import { MULTI_VALUE_SEPARATOR } from "@/lib/exports/output";

// The export column registry. Column names are the members table's
// ("email", "track:3", "form_field:12") plus export-only ones, so a name
// means the same thing on both surfaces. Mirrors is_known_export_column.

/** One exported row before it becomes cells: a member, and the assignments
 *  this row is about (all of theirs, one event's, or exactly one). */
export interface ExportRow {
  member:      MembershipFull;
  event:       TournamentEventMember | null;
  assignments: Assignment[];
}

export interface ExportContext {
  // Shift times are written in the tournament's zone, not the viewer's.
  timezone:   string;
  // Catalog key -> label ("track:3" -> "Day 1"); also names the track families.
  labels:     Map<string, string>;
  trackNames: Map<number, string>;
}

/** A cell list that spreads across columns (Pref 1, Pref 2, …) instead of
 *  being joined into one cell. */
export interface Spread { spread: string[] }

export type CellValue = string | string[] | Spread;

export interface ExportColumn {
  key:      string;
  header:   string;
  // Roster field groups this column reads, so the fetch asks for no more.
  groups:   MembershipField[];
  rowTypes: readonly ExportRowType[];
  // Takes the names / times mode.
  hasModes: boolean;
  value:    (row: ExportRow, mode: ExportColumnMode) => CellValue;
}

export const TRACK_EVENTS_PREFIX = "track_events:";
export const TRACK_ROLES_PREFIX = "track_roles:";
export const TRACK_SHIFTS_PREFIX = "track_shifts:";

const ALL_ROW_TYPES: readonly ExportRowType[] = ["member", "event", "assignment"];
const NOT_ASSIGNMENT: readonly ExportRowType[] = ["member", "event"];

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

const timeFormats = new Map<string, Intl.DateTimeFormat>();

function hhmm(iso: string, timezone: string): string {
  let format = timeFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone,
    });
    timeFormats.set(timezone, format);
  }
  return format.format(new Date(iso));
}

// What both an assigned shift and an availability row can be read as.
interface ShiftLike { id: number; label: string; start: string; end: string }

function shiftText(shift: ShiftLike, mode: ExportColumnMode, timezone: string): string {
  return mode === "times" ? `${hhmm(shift.start, timezone)}-${hhmm(shift.end, timezone)}` : shift.label;
}

/** Each shift once, in time order. */
function shiftTexts(shifts: ShiftLike[], mode: ExportColumnMode, timezone: string): string[] {
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return [...byId.values()]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => shiftText(s, mode, timezone));
}

/** A select answer is stored as an option snapshot, not a bare string. */
function optionText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ("option_id" in record) return String(record.value ?? record.label ?? "");
    return Object.values(record).map(optionText).filter(Boolean).join(MULTI_VALUE_SEPARATOR);
  }
  if (Array.isArray(value)) return value.map(optionText).filter(Boolean).join(MULTI_VALUE_SEPARATOR);
  return String(value);
}

function onTrack(row: ExportRow, trackId: number): Assignment[] {
  return row.assignments.filter((a) => a.track.id === trackId);
}

function only(row: ExportRow): Assignment | undefined {
  return row.assignments[0];
}

function trackIdOf(key: string, prefix: string): number {
  return Number(key.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// Fixed columns
// ---------------------------------------------------------------------------

interface FixedDef {
  header:    string;
  groups:    MembershipField[];
  rowTypes?: readonly ExportRowType[];
  hasModes?: boolean;
  value:     (row: ExportRow, mode: ExportColumnMode, ctx: ExportContext) => CellValue;
}

const FIXED: Record<string, FixedDef> = {
  first_name:          { header: "First name", groups: [], value: (r) => r.member.user.first_name ?? "" },
  last_name:           { header: "Last name", groups: [], value: (r) => r.member.user.last_name ?? "" },
  email:               { header: "Email", groups: ["contact"], value: (r) => r.member.user.email },
  phone:               { header: "Phone", groups: ["contact"], value: (r) => r.member.user.phone ?? "" },
  shirt_size:          { header: "Shirt size", groups: ["profile"], value: (r) => r.member.user.shirt_size ?? "" },
  dietary_restriction: { header: "Dietary restriction", groups: ["profile"], value: (r) => r.member.user.dietary_restriction ?? "" },
  // Every role held tournament-wide, whatever the row is about.
  roles:               { header: "Roles", groups: ["roles"], value: (r) => unique((r.member.roles ?? []).map((role) => role.label)) },
  // Blank when the member withheld consent or the tournament doesn't ask.
  over_18:             { header: "Over 18", groups: ["age"], value: (r) => yesNo(r.member.is_over_18) },
  over_21:             { header: "Over 21", groups: ["age"], value: (r) => yesNo(r.member.is_over_21) },
  event: {
    header: "Event", groups: ["assignments"], rowTypes: ["event", "assignment"],
    value: (r) => (r.event ? eventNameWithDivision(r.event) : ""),
  },
  // The tracks behind this row's assignments.
  tracks: {
    header: "Tracks", groups: ["assignments"], rowTypes: NOT_ASSIGNMENT,
    value: (r) => unique(r.assignments.map((a) => a.track.name)),
  },
  assigned_role: {
    header: "Assigned role", groups: ["assignments"], rowTypes: ["assignment"],
    value: (r) => only(r)?.role.label ?? "",
  },
  track: {
    header: "Track", groups: ["assignments"], rowTypes: ["assignment"],
    value: (r) => only(r)?.track.name ?? "",
  },
  // Blank for an unpinned assignment (test writing has no shifts).
  shift: {
    header: "Shift", groups: ["assignments"], rowTypes: ["assignment"], hasModes: true,
    value: (r, mode, ctx) => {
      const shift = only(r)?.shift;
      return shift ? shiftText(shift, mode, ctx.timezone) : "";
    },
  },
};

// ---------------------------------------------------------------------------
// Per-entity columns
// ---------------------------------------------------------------------------

function entityColumn(key: string, ctx: ExportContext): ExportColumn | null {
  const label = ctx.labels.get(key);

  if (key.startsWith(TRACK_PREFIX)) {
    const trackId = trackIdOf(key, TRACK_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return {
      key, header: `${name} status`, groups: ["tracks"], rowTypes: ALL_ROW_TYPES, hasModes: false,
      value: (r) => capitalize((r.member.track_statuses ?? []).find((t) => t.track_id === trackId)?.status ?? ""),
    };
  }

  if (key.startsWith(AVAILABILITY_TRACK_PREFIX)) {
    const trackId = trackIdOf(key, AVAILABILITY_TRACK_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return {
      key, header: `${name} availability`, groups: ["availability"], rowTypes: ALL_ROW_TYPES, hasModes: true,
      value: (r, mode) => shiftTexts(
        (r.member.availability ?? [])
          .filter((s) => s.track_id === trackId)
          .map((s) => ({ id: s.shift_id, label: s.label, start: s.start, end: s.end })),
        mode, ctx.timezone,
      ),
    };
  }

  if (key.startsWith(LUNCH_PREFIX)) {
    if (!label) return null;
    const rest = key.slice(LUNCH_PREFIX.length);
    const separator = rest.indexOf(":");
    const trackId = Number(rest.slice(0, separator));
    const category = rest.slice(separator + 1);
    return {
      key, header: label, groups: ["lunch"], rowTypes: ALL_ROW_TYPES, hasModes: false,
      value: (r) => (r.member.lunch ?? [])
        .filter((row) => row.track_id === trackId && row.category === category)
        .map((row) => row.value),
    };
  }

  if (key.startsWith(EVENT_PREF_PREFIX)) {
    const trackId = trackIdOf(key, EVENT_PREF_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return {
      key, header: `${name} pref`, groups: ["event_prefs"], rowTypes: ALL_ROW_TYPES, hasModes: false,
      value: (r) => {
        const answer = (r.member.event_preferences ?? []).find((p) => p.track_id === trackId);
        // Rank order; unranked picks (a checkbox question) after the ranked ones.
        const options = [...(answer?.options ?? [])].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
        // A grouped option is written as the events inside it.
        return {
          spread: options.map((option) => (
            option.events.length > 0
              ? option.events.map(eventNameWithDivision).join(MULTI_VALUE_SEPARATOR)
              : option.label
          )),
        };
      },
    };
  }

  if (key.startsWith(FORM_FIELD_PREFIX)) {
    if (!label) return null;
    const fieldId = key.slice(FORM_FIELD_PREFIX.length);
    return {
      key, header: label, groups: ["custom"], rowTypes: ALL_ROW_TYPES, hasModes: false,
      value: (r) => {
        const answer = (r.member.custom_responses ?? []).find((a) => a.field_id === fieldId);
        if (!answer || answer.value === null || answer.value === undefined) return "";
        // Stored as {"1": option, "2": option}; one column per rank.
        if (answer.question_type === "ranked_choice" && typeof answer.value === "object") {
          const ranked = Object.entries(answer.value as Record<string, unknown>)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, option]) => optionText(option));
          return { spread: ranked };
        }
        if (Array.isArray(answer.value)) return answer.value.map(optionText);
        return optionText(answer.value);
      },
    };
  }

  if (key.startsWith(TRACK_EVENTS_PREFIX)) {
    const trackId = trackIdOf(key, TRACK_EVENTS_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return {
      key, header: `${name} events`, groups: ["assignments"], rowTypes: ["member"], hasModes: false,
      value: (r) => unique(onTrack(r, trackId).map((a) => eventNameWithDivision(a.event))),
    };
  }

  if (key.startsWith(TRACK_ROLES_PREFIX)) {
    const trackId = trackIdOf(key, TRACK_ROLES_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return {
      key, header: `${name} roles`, groups: ["assignments"], rowTypes: NOT_ASSIGNMENT, hasModes: false,
      value: (r) => unique(onTrack(r, trackId).map((a) => a.role.label)),
    };
  }

  if (key.startsWith(TRACK_SHIFTS_PREFIX)) {
    const trackId = trackIdOf(key, TRACK_SHIFTS_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return {
      key, header: `${name} shifts`, groups: ["assignments"], rowTypes: NOT_ASSIGNMENT, hasModes: true,
      value: (r, mode) => shiftTexts(
        onTrack(r, trackId).flatMap((a) => (a.shift ? [a.shift] : [])), mode, ctx.timezone,
      ),
    };
  }

  return null;
}

/** The column behind `key`, or null when it no longer resolves (a deleted
 *  track or form field) — a stale column is skipped, never an error. */
export function resolveExportColumn(key: string, ctx: ExportContext): ExportColumn | null {
  const fixed = FIXED[key];
  if (fixed) {
    return {
      key,
      header: fixed.header,
      groups: fixed.groups,
      rowTypes: fixed.rowTypes ?? ALL_ROW_TYPES,
      hasModes: fixed.hasModes ?? false,
      value: (row, mode) => fixed.value(row, mode, ctx),
    };
  }
  return entityColumn(key, ctx);
}

// ---------------------------------------------------------------------------
// What the builder offers
// ---------------------------------------------------------------------------

export interface ExportColumnGroup {
  title:   string;
  columns: { key: string; header: string }[];
}

/** Every column the builder can offer for `rowType`, grouped for the picker.
 *  `trackId` narrows the per-track families to one track. */
export function availableExportColumns(
  catalog: DisplayConfigCatalog,
  rowType: ExportRowType,
  trackId: number | null,
  ctx: ExportContext,
): ExportColumnGroup[] {
  const tracks = catalog.tracks
    .map((t) => trackIdOf(t.key, TRACK_PREFIX))
    .filter((id) => trackId === null || id === trackId);
  const keepTrack = (key: string, prefix: string) => trackId === null || trackIdOf(key, prefix) === trackId;
  const lunchTrack = (key: string) => Number(key.slice(LUNCH_PREFIX.length).split(":")[0]);

  const groups: { title: string; keys: string[] }[] = [
    {
      title: "Member",
      keys: ["first_name", "last_name", "email", "phone", "shirt_size", "dietary_restriction", "roles", "over_18", "over_21"],
    },
    {
      title: "Assignments",
      keys: [
        "event", "tracks", "assigned_role", "track", "shift",
        ...tracks.flatMap((id) => [
          `${TRACK_EVENTS_PREFIX}${id}`, `${TRACK_ROLES_PREFIX}${id}`, `${TRACK_SHIFTS_PREFIX}${id}`,
        ]),
      ],
    },
    { title: "Track status", keys: catalog.tracks.map((t) => t.key).filter((k) => keepTrack(k, TRACK_PREFIX)) },
    { title: "Availability", keys: catalog.availability.map((t) => t.key).filter((k) => keepTrack(k, AVAILABILITY_TRACK_PREFIX)) },
    { title: "Lunch", keys: catalog.lunch_categories.map((t) => t.key).filter((k) => trackId === null || lunchTrack(k) === trackId) },
    { title: "Event preferences", keys: catalog.event_preferences.map((t) => t.key).filter((k) => keepTrack(k, EVENT_PREF_PREFIX)) },
    { title: "Form responses", keys: catalog.custom_fields.map((t) => t.key) },
  ];

  return groups
    .map(({ title, keys }) => ({
      title,
      columns: keys
        .map((key) => resolveExportColumn(key, ctx))
        .filter((c): c is ExportColumn => c !== null && c.rowTypes.includes(rowType))
        .map((c) => ({ key: c.key, header: c.header })),
    }))
    .filter((group) => group.columns.length > 0);
}

/** The context the registry needs, from the display-config catalog. */
export function exportContext(catalog: DisplayConfigCatalog, timezone: string): ExportContext {
  const labels = new Map<string, string>();
  for (const items of [catalog.tracks, catalog.availability, catalog.lunch_categories, catalog.event_preferences, catalog.custom_fields]) {
    for (const item of items) labels.set(item.key, item.label);
  }
  const trackNames = new Map(catalog.tracks.map((t) => [trackIdOf(t.key, TRACK_PREFIX), t.label]));
  return { timezone, labels, trackNames };
}
