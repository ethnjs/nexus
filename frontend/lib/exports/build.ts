import type {
  DisplayConfigSort, ExportPresetColumn, ExportRowType, MembershipField, MembershipFull,
} from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import {
  CellValue, ExportColumn, ExportContext, ExportRow, Spread, resolveExportColumn,
} from "@/lib/exports/columns";
import { MULTI_VALUE_SEPARATOR } from "@/lib/exports/output";

// Roster rows -> an export table. Pure: the modal fetches, this shapes.

export interface ExportSpec {
  rowType:       ExportRowType;
  columns:       ExportPresetColumn[];
  sorts:         DisplayConfigSort[];
  includeHeader: boolean;
  // Frontend-only track picker: null = every track.
  trackId:       number | null;
  // Events passing the modal's event filters; null = no event filter.
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

/** One ExportRow per member, per (member, event) or per assignment, after the
 *  track and event scopes trim each member's assignments. */
export function buildExportRows(members: MembershipFull[], spec: ExportSpec): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const member of members) {
    const assignments = (member.assignments ?? []).filter((a) => (
      (spec.trackId === null || a.track.id === spec.trackId)
      && (spec.eventIds === null || spec.eventIds.has(a.event.id))
    ));

    if (spec.rowType === "member") {
      rows.push({ member, event: null, assignments });
    } else if (spec.rowType === "assignment") {
      for (const assignment of assignments) {
        rows.push({ member, event: assignment.event, assignments: [assignment] });
      }
    } else {
      // Same event across tracks and shifts collapses into one row.
      const byEvent = new Map<number, typeof assignments>();
      for (const assignment of assignments) {
        byEvent.set(assignment.event.id, [...(byEvent.get(assignment.event.id) ?? []), assignment]);
      }
      const events = [...byEvent.values()]
        .map((group) => ({ event: group[0].event, assignments: group }))
        .sort((a, b) => eventNameWithDivision(a.event).localeCompare(eventNameWithDivision(b.event)));
      for (const { event, assignments: group } of events) {
        rows.push({ member, event, assignments: group });
      }
    }
  }
  return rows;
}

function isSpread(value: CellValue): value is Spread {
  return typeof value === "object" && !Array.isArray(value);
}

/** A non-spread value as one cell's text. */
function cellText(value: string | string[]): string {
  return Array.isArray(value) ? value.join(MULTI_VALUE_SEPARATOR) : value;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildExportTable(members: MembershipFull[], spec: ExportSpec, ctx: ExportContext): ExportTable {
  // Stale or wrong-row-type columns drop out rather than erroring.
  const resolved = spec.columns
    .map((c) => ({ column: resolveExportColumn(c.key, ctx), mode: c.mode ?? "names" }))
    .filter((c): c is { column: ExportColumn; mode: "names" | "times" } => (
      c.column !== null && c.column.rowTypes.includes(spec.rowType)
    ));

  const rows = buildExportRows(members, spec);
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
  // keep roster order.
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
