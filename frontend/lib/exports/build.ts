import type {
  DisplayConfigSort, ExportPresetColumn, ExportRowType, MembershipField, MembershipFull, TournamentEvent,
} from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import {
  CellValue, ExportColumn, ExportContext, ExportRow, Spread, columnMode, resolveExportColumn,
} from "@/lib/exports/columns";
import { MULTI_VALUE_SEPARATOR } from "@/lib/exports/output";

// Roster and event rows -> an export table. Pure: the caller fetches, this shapes.

export interface ExportSpec {
  rowType:       ExportRowType;
  columns:       ExportPresetColumn[];
  sorts:         DisplayConfigSort[];
  includeHeader: boolean;
  // Frontend-only track picker: null = every track.
  trackId:       number | null;
  // Events passing the event filters; null = no event filter.
  eventIds:      Set<number> | null;
}

export interface ExportTable {
  header: string[] | null;
  rows:   string[][];
}

/** The roster field groups `columns` read — what the fetch should ask for. */
export function fieldsForColumns(columns: ExportPresetColumn[], ctx: ExportContext): MembershipField[] {
  const groups = new Set<MembershipField>();
  for (const { key } of columns) {
    for (const group of resolveExportColumn(key, ctx)?.groups ?? []) groups.add(group);
  }
  return [...groups];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function byName(a: MembershipFull, b: MembershipFull): number {
  return collator.compare(a.user.last_name ?? "", b.user.last_name ?? "")
    || collator.compare(a.user.first_name ?? "", b.user.first_name ?? "")
    || collator.compare(a.user.email, b.user.email);
}

/**
 * One row per member, or one per event.
 *
 * Event rows come from the event list, not from assignments, so an event
 * nobody is staffing still gets a row — the gap is the point. Its members are
 * the (already filtered) roster's, assigned to it on the export's track.
 */
export function buildExportRows(members: MembershipFull[], events: TournamentEvent[], spec: ExportSpec): ExportRow[] {
  const counts = (a: { track: { id: number }; event: { id: number } }) => (
    (spec.trackId === null || a.track.id === spec.trackId)
    && (spec.eventIds === null || spec.eventIds.has(a.event.id))
  );

  if (spec.rowType === "member") {
    return members.map((member) => ({
      kind: "member", member, assignments: (member.assignments ?? []).filter(counts),
    }));
  }

  const assigned = new Map<number, Set<MembershipFull>>();
  for (const member of members) {
    for (const a of member.assignments ?? []) {
      if (!counts(a)) continue;
      // A Set: the same person on two shifts of one event appears once.
      assigned.set(a.event.id, (assigned.get(a.event.id) ?? new Set()).add(member));
    }
  }
  return events
    .filter((event) => (
      (spec.trackId === null || event.track_details.some((d) => d.track_id === spec.trackId))
      && (spec.eventIds === null || spec.eventIds.has(event.id))
    ))
    .sort((a, b) => collator.compare(eventNameWithDivision(a), eventNameWithDivision(b)))
    .map((event) => ({
      kind: "event",
      event,
      members: [...(assigned.get(event.id) ?? [])].sort(byName),
      trackId: spec.trackId,
    }));
}

function isSpread(value: CellValue): value is Spread {
  return typeof value === "object" && !Array.isArray(value);
}

/** A non-spread value as one cell's text. */
function cellText(value: string | string[]): string {
  return Array.isArray(value) ? value.join(MULTI_VALUE_SEPARATOR) : value;
}

export function buildExportTable(
  members: MembershipFull[],
  events: TournamentEvent[],
  spec: ExportSpec,
  ctx: ExportContext,
): ExportTable {
  // Stale or wrong-row-type columns drop out rather than erroring.
  const resolved = spec.columns
    .map((c) => {
      const column = resolveExportColumn(c.key, ctx);
      return column && { column, mode: columnMode(column, c.mode) };
    })
    .filter((c): c is { column: ExportColumn; mode: ReturnType<typeof columnMode> } => (
      c !== null && c.column.rowTypes.includes(spec.rowType)
    ));

  const rows = buildExportRows(members, events, spec);
  const values = rows.map((row) => resolved.map(({ column, mode }) => column.value(row, mode)));

  // A spread column is as wide as its longest value across every row.
  const widths = resolved.map((_, i) => (
    values.reduce((width, row) => {
      const value = row[i];
      return isSpread(value) ? Math.max(width, value.spread.length) : width;
    }, 0)
  ));
  const spreads = resolved.map((_, i) => values.some((row) => isSpread(row[i])));

  const cellsOf = (row: CellValue[]): string[] => row.flatMap((value, i) => {
    if (!spreads[i]) return [cellText(value as string | string[])];
    const spread = isSpread(value) ? value.spread : [];
    return Array.from({ length: widths[i] }, (_, n) => spread[n] ?? "");
  });

  // Sort on the first cell a column produces. Array.sort is stable, so ties
  // keep the rows' own order (roster order, or event name).
  const sortIndexes = spec.sorts
    .map((sort) => ({ index: resolved.findIndex((c) => c.column.key === sort.field), direction: sort.direction }))
    .filter((sort) => sort.index !== -1);
  const sortText = (row: CellValue[], index: number): string => {
    const value = row[index];
    return isSpread(value) ? value.spread[0] ?? "" : cellText(value);
  };
  const order = values.map((_, i) => i);
  if (sortIndexes.length > 0) {
    order.sort((a, b) => {
      for (const { index, direction } of sortIndexes) {
        const result = collator.compare(sortText(values[a], index), sortText(values[b], index));
        if (result !== 0) return direction === "desc" ? -result : result;
      }
      return 0;
    });
  }

  const header = spec.includeHeader
    ? resolved.flatMap(({ column }, i) => (
      spreads[i]
        ? Array.from({ length: widths[i] }, (_, n) => `${column.header} ${n + 1}`)
        : [column.header]
    ))
    : null;

  return { header, rows: order.map((i) => cellsOf(values[i])) };
}
