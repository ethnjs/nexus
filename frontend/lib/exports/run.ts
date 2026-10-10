import {
  Assignment, DisplayConfigCatalog, DuosmiumRole, ExportPresetInput, MembershipField, MembershipFull,
  TorusRole, Tournament, TournamentEvent, assignmentsApi, displayConfigApi, membersApi, tournamentEventsApi,
} from "@/lib/api";
import { buildExportTable, fieldsForColumns } from "@/lib/exports/build";
import { BUILTINS, buildDuosmium, buildEmailList, buildTorus } from "@/lib/exports/builtins";
import { ExportContext, exportContext, resolveExportColumn } from "@/lib/exports/columns";
import { EXTERNAL_SYSTEMS } from "@/lib/exports/externalSystems";
import { exportFilename, toCsv } from "@/lib/exports/output";
import { tournamentDisplayName } from "@/lib/tournamentDisplay";
import {
  EventsFilterState, eventPassesFilters, isEventsFilterActive,
} from "@/components/tournament/events/EventsFilterModal";
import { MembersFilterState, membersFilterParams } from "@/components/tournament/members/MembersFilterModal";

// One export, fully decided: which preset and every choice it needs. Both the
// one-click button and the export screen resolve to this, so they can't
// produce different text for the same choice.

export type ExportChoice =
  | { kind: "torus"; trackId: number; role: TorusRole }
  | { kind: "duosmium"; trackId: number; division: string; roles: DuosmiumRole[] }
  | { kind: "email_list" }
  | { kind: "custom"; presetId: number | null; shape: ExportPresetInput; trackId: number | null };

export interface ExportResult {
  header:   string[] | null;
  rows:     string[][];
  text:     string;
  warnings: string[];
}

const TORUS_ROLES = EXTERNAL_SYSTEMS.find((s) => s.field === "torus_role")!.roles;

export function usesEventFilters(choice: ExportChoice): boolean {
  if (choice.kind === "custom") return true;
  return BUILTINS.find((b) => b.id === choice.kind)!.usesEventFilters;
}

/** The roster field groups this export reads. */
export function fieldsForChoice(choice: ExportChoice, ctx: ExportContext | null): MembershipField[] {
  if (choice.kind !== "custom") return BUILTINS.find((b) => b.id === choice.kind)!.fields;
  const groups = new Set(ctx ? fieldsForColumns(choice.shape.columns, ctx) : []);
  // Event and assignment rows are built from assignments.
  if (choice.shape.row_type !== "member") groups.add("assignments");
  return [...groups];
}

/** Events passing the event filters, or null when none apply. */
export function eventIdsFor(
  choice: ExportChoice,
  eventFilters: EventsFilterState,
  events: TournamentEvent[],
  assignments: Assignment[],
): Set<number> | null {
  if (!usesEventFilters(choice) || !isEventsFilterActive(eventFilters)) return null;
  const trackId = choice.kind === "email_list" ? null : choice.trackId;
  const byEvent = new Map<number, Assignment[]>();
  for (const a of assignments) byEvent.set(a.event.id, [...(byEvent.get(a.event.id) ?? []), a]);
  const showsTrack = (id: number) => trackId === null || id === trackId;
  return new Set(events
    .filter((event) => eventPassesFilters(event, eventFilters, { assignmentsFor: (id) => byEvent.get(id) ?? [], showsTrack }))
    .map((event) => event.id));
}

export function computeExport(
  choice: ExportChoice,
  members: MembershipFull[],
  // Every event: per-event rows include the ones nobody is staffing.
  events: TournamentEvent[],
  eventIds: Set<number> | null,
  ctx: ExportContext | null,
): ExportResult {
  if (choice.kind === "torus") return { header: null, ...buildTorus(members, choice.role, { trackId: choice.trackId, eventIds }) };
  if (choice.kind === "duosmium") {
    return { header: null, ...buildDuosmium(members, choice.roles, { trackId: choice.trackId, eventIds, division: choice.division }) };
  }
  if (choice.kind === "email_list") return { header: null, ...buildEmailList(members) };
  if (!ctx) throw new Error("A custom export needs the column catalog");

  const { shape } = choice;
  const table = buildExportTable(members, events, {
    rowType: shape.row_type, columns: shape.columns, sorts: shape.sorts,
    includeHeader: shape.include_header, trackId: choice.trackId, eventIds,
  }, ctx);
  const stale = shape.columns.filter((c) => !resolveExportColumn(c.key, ctx)).length;
  return {
    header: table.header,
    rows: table.rows,
    text: toCsv(table.header ? [table.header, ...table.rows] : table.rows),
    warnings: stale > 0
      ? [`${stale} column${stale === 1 ? "" : "s"} no longer available (a deleted track or form field) — skipped.`]
      : [],
  };
}

/** What the choice is beyond its preset: "Test Writers, Day 1". */
function scopeParts(choice: ExportChoice, trackNames: Map<number, string>): string[] {
  if (choice.kind === "torus") {
    return [`${TORUS_ROLES[choice.role].label}s`, trackNames.get(choice.trackId) ?? ""].filter(Boolean);
  }
  if (choice.kind === "duosmium") {
    return [trackNames.get(choice.trackId) ?? "", `Division ${choice.division}`].filter(Boolean);
  }
  if (choice.kind === "custom" && choice.trackId !== null) return [trackNames.get(choice.trackId) ?? ""].filter(Boolean);
  return [];
}

function presetName(choice: ExportChoice): string {
  if (choice.kind === "custom") return choice.shape.name.trim() || "Export";
  return BUILTINS.find((b) => b.id === choice.kind)!.label;
}

/** "TORUS: Test Writers, Day 1", "Lunch counts". */
export function exportLabel(choice: ExportChoice, trackNames: Map<number, string>): string {
  const scope = scopeParts(choice, trackNames);
  return scope.length > 0 ? `${presetName(choice)}: ${scope.join(", ")}` : presetName(choice);
}

export function exportFilenameFor(choice: ExportChoice, tournament: Tournament, trackNames: Map<number, string>): string {
  return exportFilename([tournamentDisplayName(tournament), presetName(choice), ...scopeParts(choice, trackNames)]);
}

export function trackNamesOf(tournament: Tournament): Map<number, string> {
  return new Map(tournament.tracks.map((t) => [t.id, t.name]));
}

/** Fetches what `choice` needs and builds it — the one-click path. The
 *  export screen does the same fetches reactively instead. */
export async function runExport(
  tournament: Tournament,
  choice: ExportChoice,
  memberFilters: MembersFilterState,
  eventFilters: EventsFilterState,
): Promise<ExportResult> {
  // Event filters judge events; per-event rows are built from them.
  const needsEvents = (usesEventFilters(choice) && isEventsFilterActive(eventFilters))
    || (choice.kind === "custom" && choice.shape.row_type === "event");
  const [catalog, events, assignments] = await Promise.all([
    choice.kind === "custom" ? displayConfigApi.getCatalog(tournament.id) : Promise.resolve<DisplayConfigCatalog | null>(null),
    needsEvents ? tournamentEventsApi.list(tournament.id) : Promise.resolve<TournamentEvent[]>([]),
    needsEvents ? assignmentsApi.list(tournament.id) : Promise.resolve<Assignment[]>([]),
  ]);
  const ctx = catalog ? exportContext(catalog, tournament.timezone) : null;
  const members = await membersApi.list(tournament.id, {
    fields: fieldsForChoice(choice, ctx),
    filters: membersFilterParams(memberFilters),
  });
  return computeExport(choice, members, events, eventIdsFor(choice, eventFilters, events, assignments), ctx);
}
