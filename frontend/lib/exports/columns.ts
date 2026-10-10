import type {
  Assignment, DisplayConfigCatalog, ExportColumnMode, ExportRowType, MembershipField,
  MembershipFull, TournamentEvent,
} from "@/lib/api";
import { eventNameWithDivision, trackLocationLabel } from "@/lib/eventDisplay";
import {
  AVAILABILITY_TRACK_PREFIX, EVENT_PREF_PREFIX, FORM_FIELD_PREFIX, LUNCH_PREFIX, TRACK_PREFIX,
} from "@/lib/memberColumnKeys";
import { userName } from "@/lib/personDisplay";
import { MULTI_VALUE_SEPARATOR } from "@/lib/exports/output";

// The export column registry. Column names are the members table's
// ("email", "track:3", "form_field:12") plus export-only ones, so a name
// means the same thing on both surfaces. Mirrors is_known_export_column.

/** A member and their assignments, trimmed to the export's track and events. */
export interface MemberRow {
  kind:        "member";
  member:      MembershipFull;
  assignments: Assignment[];
}

/** An event and everyone assigned to it, alphabetical. */
export interface EventRow {
  kind:    "event";
  event:   TournamentEvent;
  members: MembershipFull[];
  // The export's track, if one was picked — the location is that track's.
  trackId: number | null;
}

export type ExportRow = MemberRow | EventRow;

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

export interface ColumnModeOption {
  value: ExportColumnMode;
  label: string;
}

export interface ExportColumn {
  key:      string;
  header:   string;
  // Roster field groups this column reads, so the fetch asks for no more.
  groups:   MembershipField[];
  rowTypes: readonly ExportRowType[];
  // The ways this column can write its values; the first is the default.
  modes:    readonly ColumnModeOption[];
  value:    (row: ExportRow, mode: ExportColumnMode) => CellValue;
}

export const TRACK_EVENTS_PREFIX = "track_events:";
export const TRACK_ROLES_PREFIX = "track_roles:";
export const TRACK_SHIFTS_PREFIX = "track_shifts:";

const MEMBER_ROWS: readonly ExportRowType[] = ["member"];
const EVENT_ROWS: readonly ExportRowType[] = ["event"];

const NO_MODES: readonly ColumnModeOption[] = [];
const SHIFT_MODES: readonly ColumnModeOption[] = [
  { value: "names", label: "Names" },
  { value: "times", label: "Times" },
];
const PERSON_MODES: readonly ColumnModeOption[] = [
  { value: "full_name", label: "Name" },
  { value: "email", label: "Email" },
];

/** The mode a column uses when the preset doesn't name one it offers. */
export function columnMode(column: ExportColumn, mode: ExportColumnMode | null | undefined): ExportColumnMode {
  return column.modes.some((m) => m.value === mode) ? mode! : column.modes[0]?.value ?? "names";
}

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

/** Each shift once, in time order, as names or "08:00-12:00" ranges. */
function shiftTexts(shifts: ShiftLike[], mode: ExportColumnMode, timezone: string): string[] {
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return [...byId.values()]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => (mode === "times" ? `${hhmm(s.start, timezone)}-${hhmm(s.end, timezone)}` : s.label));
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

function trackIdOf(key: string, prefix: string): number {
  return Number(key.slice(prefix.length));
}

/** A member-row value; an event row never reaches it (rowTypes keeps it off). */
function ofMember(fn: (row: MemberRow, mode: ExportColumnMode) => CellValue) {
  return (row: ExportRow, mode: ExportColumnMode): CellValue => (row.kind === "member" ? fn(row, mode) : "");
}

function ofEvent(fn: (row: EventRow, mode: ExportColumnMode) => CellValue) {
  return (row: ExportRow, mode: ExportColumnMode): CellValue => (row.kind === "event" ? fn(row, mode) : "");
}

// ---------------------------------------------------------------------------
// Fixed columns
// ---------------------------------------------------------------------------

type FixedDef = Omit<ExportColumn, "key" | "value" | "modes"> & {
  modes?: readonly ColumnModeOption[];
  value:  (ctx: ExportContext) => ExportColumn["value"];
};

const memberFixed = (header: string, groups: MembershipField[], fn: (row: MemberRow) => CellValue): FixedDef => ({
  header, groups, rowTypes: MEMBER_ROWS, value: () => ofMember(fn),
});

const FIXED: Record<string, FixedDef> = {
  first_name:          memberFixed("First name", [], (r) => r.member.user.first_name ?? ""),
  last_name:           memberFixed("Last name", [], (r) => r.member.user.last_name ?? ""),
  email:               memberFixed("Email", ["contact"], (r) => r.member.user.email),
  phone:               memberFixed("Phone", ["contact"], (r) => r.member.user.phone ?? ""),
  shirt_size:          memberFixed("Shirt size", ["profile"], (r) => r.member.user.shirt_size ?? ""),
  dietary_restriction: memberFixed("Dietary restriction", ["profile"], (r) => r.member.user.dietary_restriction ?? ""),
  // Every role held tournament-wide, not just the ones staffed.
  roles:               memberFixed("Roles", ["roles"], (r) => unique((r.member.roles ?? []).map((role) => role.label))),
  // Blank when the member withheld consent or the tournament doesn't ask.
  over_18:             memberFixed("Over 18", ["age"], (r) => yesNo(r.member.is_over_18)),
  over_21:             memberFixed("Over 21", ["age"], (r) => yesNo(r.member.is_over_21)),
  // The tracks this member is staffed on.
  tracks:              memberFixed("Tracks", ["assignments"], (r) => unique(r.assignments.map((a) => a.track.name))),

  event: {
    header: "Event", groups: [], rowTypes: EVENT_ROWS,
    value: () => ofEvent((r) => eventNameWithDivision(r.event)),
  },
  // "Kerckhoff 101, 103" on the export's track; every track's, when none is picked.
  location: {
    header: "Location", groups: [], rowTypes: EVENT_ROWS,
    value: () => ofEvent((r) => unique(
      r.event.track_details
        .filter((d) => r.trackId === null || d.track_id === r.trackId)
        .map((d) => trackLocationLabel(d) ?? ""),
    )),
  },
  // Everyone assigned, one per column, after the event's own columns.
  members: {
    header: "Member", groups: ["assignments", "contact"], rowTypes: EVENT_ROWS, modes: PERSON_MODES,
    value: () => ofEvent((r, mode) => ({
      spread: r.members.map((m) => (mode === "email" ? m.user.email : userName(m.user))),
    })),
  },
};

// ---------------------------------------------------------------------------
// Per-entity columns — all about one member
// ---------------------------------------------------------------------------

function memberColumn(
  key: string, header: string, groups: MembershipField[],
  fn: (row: MemberRow, mode: ExportColumnMode) => CellValue,
  modes: readonly ColumnModeOption[] = NO_MODES,
): ExportColumn {
  return { key, header, groups, rowTypes: MEMBER_ROWS, modes, value: ofMember(fn) };
}

function entityColumn(key: string, ctx: ExportContext): ExportColumn | null {
  const label = ctx.labels.get(key);

  if (key.startsWith(TRACK_PREFIX)) {
    const trackId = trackIdOf(key, TRACK_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return memberColumn(key, `${name} status`, ["tracks"], (r) => (
      capitalize((r.member.track_statuses ?? []).find((t) => t.track_id === trackId)?.status ?? "")
    ));
  }

  if (key.startsWith(AVAILABILITY_TRACK_PREFIX)) {
    const trackId = trackIdOf(key, AVAILABILITY_TRACK_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return memberColumn(key, `${name} availability`, ["availability"], (r, mode) => shiftTexts(
      (r.member.availability ?? [])
        .filter((s) => s.track_id === trackId)
        .map((s) => ({ id: s.shift_id, label: s.label, start: s.start, end: s.end })),
      mode, ctx.timezone,
    ), SHIFT_MODES);
  }

  if (key.startsWith(LUNCH_PREFIX)) {
    if (!label) return null;
    const rest = key.slice(LUNCH_PREFIX.length);
    const separator = rest.indexOf(":");
    const trackId = Number(rest.slice(0, separator));
    const category = rest.slice(separator + 1);
    return memberColumn(key, label, ["lunch"], (r) => (r.member.lunch ?? [])
      .filter((row) => row.track_id === trackId && row.category === category)
      .map((row) => row.value));
  }

  if (key.startsWith(EVENT_PREF_PREFIX)) {
    const trackId = trackIdOf(key, EVENT_PREF_PREFIX);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    return memberColumn(key, `${name} pref`, ["event_prefs"], (r) => {
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
    });
  }

  if (key.startsWith(FORM_FIELD_PREFIX)) {
    if (!label) return null;
    const fieldId = key.slice(FORM_FIELD_PREFIX.length);
    return memberColumn(key, label, ["custom"], (r) => {
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
    });
  }

  const trackFamily = [
    { prefix: TRACK_EVENTS_PREFIX, noun: "events" },
    { prefix: TRACK_ROLES_PREFIX, noun: "roles" },
    { prefix: TRACK_SHIFTS_PREFIX, noun: "shifts" },
  ].find((f) => key.startsWith(f.prefix));
  if (trackFamily) {
    const trackId = trackIdOf(key, trackFamily.prefix);
    const name = ctx.trackNames.get(trackId);
    if (!name) return null;
    const onTrack = (r: MemberRow) => r.assignments.filter((a) => a.track.id === trackId);
    const header = `${name} ${trackFamily.noun}`;
    if (trackFamily.prefix === TRACK_EVENTS_PREFIX) {
      return memberColumn(key, header, ["assignments"], (r) => unique(onTrack(r).map((a) => eventNameWithDivision(a.event))));
    }
    if (trackFamily.prefix === TRACK_ROLES_PREFIX) {
      return memberColumn(key, header, ["assignments"], (r) => unique(onTrack(r).map((a) => a.role.label)));
    }
    return memberColumn(key, header, ["assignments"], (r, mode) => shiftTexts(
      onTrack(r).flatMap((a) => (a.shift ? [a.shift] : [])), mode, ctx.timezone,
    ), SHIFT_MODES);
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
      rowTypes: fixed.rowTypes,
      modes: fixed.modes ?? NO_MODES,
      value: fixed.value(ctx),
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
    { title: "Event", keys: ["event", "location", "members"] },
    {
      title: "Member",
      keys: ["first_name", "last_name", "email", "phone", "shirt_size", "dietary_restriction", "roles", "over_18", "over_21"],
    },
    {
      title: "Assignments",
      keys: [
        "tracks",
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
