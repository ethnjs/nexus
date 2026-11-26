import { eventFilterFields } from "@/components/tournament/events/eventFilterFields";
import {
  type Assignment,
  assignmentsApi,
  auditLogApi,
  type DisplayConfigCatalog,
  type DuosmiumRole,
  displayConfigApi,
  type ExportOutput,
  type ExportPresetInput,
  type FilterGroup,
  type MembershipField,
  type MembershipFull,
  membersApi,
  type TorusRole,
  type Tournament,
  type TournamentEvent,
  tournamentEventsApi,
} from "@/lib/api";
import { buildExportTable, fieldsForColumns } from "@/lib/exports/build";
import { BUILTINS, buildDuosmium, buildEmailList, buildTorus } from "@/lib/exports/builtins";
import { type ExportContext, exportContext, resolveExportColumn } from "@/lib/exports/columns";
import { EXTERNAL_SYSTEMS } from "@/lib/exports/externalSystems";
import { exportFilename, toCsv } from "@/lib/exports/output";
import { matchesFilter } from "@/lib/filters/match";
import { countActiveConditions, type FilterField, fieldMap } from "@/lib/filters/model";
import { tournamentDisplayName } from "@/lib/tournamentDisplay";

// One export, fully decided: which preset and every choice it needs. Both the
// one-click button and the export screen resolve to this, so they can't
// produce different text for the same choice.

export type ExportChoice =
  | { kind: "torus"; trackId: number; role: TorusRole }
  | { kind: "duosmium"; trackId: number; division: string; roles: DuosmiumRole[] }
  | { kind: "email_list" }
  | { kind: "custom"; presetId: number | null; shape: ExportPresetInput; trackId: number | null };

export interface ExportResult {
  header: string[] | null;
  rows: string[][];
  text: string;
  warnings: string[];
  /** What the audit log records about this export. */
  fields: MembershipField[];
  columns: string[] | null;
}

const TORUS_ROLES = EXTERNAL_SYSTEMS.find((s) => s.field === "torus_role")!.roles;

export function usesEventFilters(choice: ExportChoice): boolean {
  if (choice.kind === "custom") return true;
  return BUILTINS.find((b) => b.id === choice.kind)!.usesEventFilters;
}

/** The roster field groups this export reads. */
export function fieldsForChoice(
  choice: ExportChoice,
  ctx: ExportContext | null,
): MembershipField[] {
  if (choice.kind !== "custom") return BUILTINS.find((b) => b.id === choice.kind)!.fields;
  const groups = new Set(ctx ? fieldsForColumns(choice.shape.columns, ctx) : []);
  // Event and assignment rows are built from assignments.
  if (choice.shape.row_type !== "member") groups.add("assignments");
  return [...groups];
}

/** The event filter's fields for an export on `trackId` (null: every track). */
export function exportEventFields(
  trackId: number | null,
  events: TournamentEvent[],
  assignments: Assignment[],
): FilterField<TournamentEvent>[] {
  const byEvent = new Map<number, Assignment[]>();
  for (const a of assignments) byEvent.set(a.event.id, [...(byEvent.get(a.event.id) ?? []), a]);
  return eventFilterFields(events, {
    showsTrack: (id) => trackId === null || id === trackId,
    assignmentsFor: (id) => byEvent.get(id) ?? [],
    withTracks: trackId === null,
  });
}

/** Events passing the event filter, or null when it doesn't apply. */
export function eventIdsFor(
  choice: ExportChoice,
  eventFilter: FilterGroup,
  events: TournamentEvent[],
  assignments: Assignment[],
): Set<number> | null {
  if (!usesEventFilters(choice) || countActiveConditions(eventFilter) === 0) return null;
  const trackId = choice.kind === "email_list" ? null : choice.trackId;
  const fields = fieldMap(exportEventFields(trackId, events, assignments));
  return new Set(
    events.filter((event) => matchesFilter(event, eventFilter, fields)).map((event) => event.id),
  );
}

export function computeExport(
  choice: ExportChoice,
  members: MembershipFull[],
  // Every event: per-event rows include the ones nobody is staffing.
  events: TournamentEvent[],
  eventIds: Set<number> | null,
  ctx: ExportContext | null,
): ExportResult {
  const fields = fieldsForChoice(choice, ctx);
  if (choice.kind === "torus")
    return {
      header: null,
      fields,
      columns: null,
      ...buildTorus(members, choice.role, { trackId: choice.trackId, eventIds }),
    };
  if (choice.kind === "duosmium") {
    return {
      header: null,
      fields,
      columns: null,
      ...buildDuosmium(members, choice.roles, {
        trackId: choice.trackId,
        eventIds,
        division: choice.division,
      }),
    };
  }
  if (choice.kind === "email_list")
    return { header: null, fields, columns: null, ...buildEmailList(members) };
  if (!ctx) throw new Error("A custom export needs the column catalog");

  const { shape } = choice;
  const table = buildExportTable(
    members,
    events,
    {
      rowType: shape.row_type,
      columns: shape.columns,
      sorts: shape.sorts,
      includeHeader: shape.include_header,
      trackId: choice.trackId,
      eventIds,
    },
    ctx,
  );
  const resolved = shape.columns.map((c) => resolveExportColumn(c.key, ctx));
  const stale = resolved.filter((c) => !c).length;
  return {
    fields,
    columns: resolved.flatMap((c) => (c ? [c.header] : [])),
    header: table.header,
    rows: table.rows,
    text: toCsv(table.header ? [table.header, ...table.rows] : table.rows),
    warnings:
      stale > 0
        ? [
            `${stale} column${stale === 1 ? "" : "s"} no longer available (a deleted track or form field) — skipped.`,
          ]
        : [],
  };
}

/** What the choice is beyond its preset: "Test Writers, Day 1". */
function scopeParts(choice: ExportChoice, trackNames: Map<number, string>): string[] {
  if (choice.kind === "torus") {
    return [`${TORUS_ROLES[choice.role].label}s`, trackNames.get(choice.trackId) ?? ""].filter(
      Boolean,
    );
  }
  if (choice.kind === "duosmium") {
    return [trackNames.get(choice.trackId) ?? "", `Division ${choice.division}`].filter(Boolean);
  }
  if (choice.kind === "custom" && choice.trackId !== null)
    return [trackNames.get(choice.trackId) ?? ""].filter(Boolean);
  return [];
}

function presetName(choice: ExportChoice): string {
  if (choice.kind === "custom") return choice.shape.name.trim() || "Export";
  return BUILTINS.find((b) => b.id === choice.kind)!.label;
}

export function exportFilenameFor(
  choice: ExportChoice,
  tournament: Tournament,
  trackNames: Map<number, string>,
): string {
  return exportFilename([
    tournamentDisplayName(tournament),
    presetName(choice),
    ...scopeParts(choice, trackNames),
  ]);
}

/** Records a finished copy or download in the tournament's audit log. */
export function logExport(
  tournament: Tournament,
  choice: ExportChoice,
  result: ExportResult,
  output: ExportOutput,
): Promise<void> {
  const trackId = choice.kind === "email_list" ? null : choice.trackId;
  const track = trackId === null ? undefined : trackNamesOf(tournament).get(trackId);
  return auditLogApi.logExport(tournament.id, {
    preset: presetName(choice),
    ...(track ? { track } : {}),
    ...(choice.kind === "torus" ? { role: TORUS_ROLES[choice.role].label } : {}),
    ...(choice.kind === "duosmium" ? { division: choice.division } : {}),
    output,
    fields: result.fields,
    ...(result.columns ? { columns: result.columns } : {}),
  });
}

export function trackNamesOf(tournament: Tournament): Map<number, string> {
  return new Map(tournament.tracks.map((t) => [t.id, t.name]));
}

/** Fetches what `choice` needs and builds it — the one-click path. The
 *  export screen does the same fetches reactively instead. */
export async function runExport(
  tournament: Tournament,
  choice: ExportChoice,
  memberFilter: FilterGroup,
  eventFilter: FilterGroup,
): Promise<ExportResult> {
  // The event filter judges events; per-event rows are built from them.
  const needsEvents =
    (usesEventFilters(choice) && countActiveConditions(eventFilter) > 0) ||
    (choice.kind === "custom" && choice.shape.row_type === "event");
  const [catalog, events, assignments] = await Promise.all([
    choice.kind === "custom"
      ? displayConfigApi.getCatalog(tournament.id)
      : Promise.resolve<DisplayConfigCatalog | null>(null),
    needsEvents ? tournamentEventsApi.list(tournament.id) : Promise.resolve<TournamentEvent[]>([]),
    needsEvents ? assignmentsApi.list(tournament.id) : Promise.resolve<Assignment[]>([]),
  ]);
  const ctx = catalog ? exportContext(catalog, tournament.timezone) : null;
  const members = await membersApi.list(tournament.id, {
    fields: fieldsForChoice(choice, ctx),
    filter: memberFilter,
  });
  return computeExport(
    choice,
    members,
    events,
    eventIdsFor(choice, eventFilter, events, assignments),
    ctx,
  );
}
