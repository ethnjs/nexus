import type { Assignment, DuosmiumRole, MemberRole, MembershipField, MembershipFull, TorusRole } from "@/lib/api";
import { eventName, eventNameWithDivision } from "@/lib/eventDisplay";
import { EXTERNAL_SYSTEMS, ExternalRoleField } from "@/lib/exports/externalSystems";
import { toCsv } from "@/lib/exports/output";

// The code-defined presets: TORUS, Duosmium, Email list. Never saved,
// configured fresh each time. Pure: the modal fetches the roster (member
// filters already applied server-side), these shape it.

export type BuiltinId = "torus" | "duosmium" | "email_list";

export interface BuiltinResult {
  // What the preview table shows.
  rows:     string[][];
  // What Copy / Download write. Same as toCsv(rows) except for the email list.
  text:     string;
  warnings: string[];
}

export interface BuiltinInfo {
  id:    BuiltinId;
  label: string;
  // Roster field groups the builder reads.
  fields: MembershipField[];
  // Which modal controls apply, so the modal hides the ones that don't.
  usesTrack:        boolean;
  usesDivision:     boolean;
  usesEventFilters: boolean;
}

export const BUILTINS: readonly BuiltinInfo[] = [
  { id: "torus",      label: "TORUS",      fields: ["contact", "roles", "assignments"], usesTrack: true,  usesDivision: false, usesEventFilters: true },
  { id: "duosmium",   label: "Duosmium",   fields: ["contact", "roles", "assignments"], usesTrack: true,  usesDivision: true,  usesEventFilters: true },
  { id: "email_list", label: "Email list", fields: ["contact"],                         usesTrack: false, usesDivision: false, usesEventFilters: false },
];

/** Shared scope for the two external-system builders. */
interface SystemScope {
  trackId:  number;
  // Events passing the modal's event filters; null = no event filter.
  eventIds: Set<number> | null;
}

// ---------------------------------------------------------------------------
// Role mapping helpers
// ---------------------------------------------------------------------------

/** Whether `role` is held on `trackId` — tournament-wide counts everywhere. */
function heldOnTrack(role: MemberRole, trackId: number): boolean {
  return role.is_tournament_wide || role.track_ids.includes(trackId);
}

/** The member's roles on `trackId` that map to `value` in `field`. */
function mappedRoles(member: MembershipFull, field: ExternalRoleField, value: string, trackId: number): MemberRole[] {
  return (member.roles ?? []).filter((role) => role[field] === value && heldOnTrack(role, trackId));
}

/** Their assignments on the track, in those roles, passing the event filter.
 *  An assignment's role is only {id, label}, so it's matched by id against
 *  roles the member holds — being assigned in a role always means holding it. */
function mappedAssignments(member: MembershipFull, roleIds: Set<number>, scope: SystemScope): Assignment[] {
  return (member.assignments ?? []).filter((a) => (
    a.track.id === scope.trackId
    && a.role.id !== null && roleIds.has(a.role.id)
    && (scope.eventIds === null || scope.eventIds.has(a.event.id))
  ));
}

function byText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const TORUS = EXTERNAL_SYSTEMS.find((s) => s.field === "torus_role")!;
const DUOSMIUM = EXTERNAL_SYSTEMS.find((s) => s.field === "duosmium_role")!;

// ---------------------------------------------------------------------------
// TORUS — one TORUS role per export, so every row has the same shape
// ---------------------------------------------------------------------------

export function buildTorus(members: MembershipFull[], role: TorusRole, scope: SystemScope): BuiltinResult {
  const eventScoped = TORUS.roles[role].eventScoped;
  const rows: string[][] = [];
  let skipped = 0;

  for (const member of members) {
    const held = mappedRoles(member, "torus_role", role, scope.trackId);
    if (held.length === 0) continue;
    const email = member.user.email;

    if (!eventScoped) {
      rows.push([email]);
      continue;
    }
    const events = new Map(
      mappedAssignments(member, new Set(held.map((r) => r.id)), scope)
        .map((a) => [a.event.id, eventNameWithDivision(a.event)]),
    );
    if (events.size === 0) skipped++;
    for (const name of events.values()) rows.push([name, email]);
  }

  // Event then email; a bare email list just by email.
  rows.sort((a, b) => byText(a[0], b[0]) || byText(a[1] ?? "", b[1] ?? ""));
  const warnings = skipped > 0
    ? [`${plural(skipped, TORUS.roles[role].label.toLowerCase())} skipped — no event assignment on this track.`]
    : [];
  return { rows, text: toCsv(rows), warnings };
}

// ---------------------------------------------------------------------------
// Duosmium — any mix of roles, one division per export
// ---------------------------------------------------------------------------

export function buildDuosmium(
  members: MembershipFull[],
  roles: DuosmiumRole[],
  scope: SystemScope & { division: string },
): BuiltinResult {
  // Rows grouped by role in the config's order (TD, SM, ES), then by email.
  const order = (Object.keys(DUOSMIUM.roles) as DuosmiumRole[]).filter((r) => roles.includes(r));
  const rows: string[][] = [];
  let leftOut = 0;

  for (const role of order) {
    const info = DUOSMIUM.roles[role];
    const group: string[][] = [];
    for (const member of members) {
      const held = mappedRoles(member, "duosmium_role", role, scope.trackId);
      if (held.length === 0) continue;
      const row = [member.user.email, info.code!];

      if (info.eventScoped) {
        // Names without division: a Duosmium tournament is one division.
        const events = [...new Set(
          mappedAssignments(member, new Set(held.map((r) => r.id)), scope)
            .filter((a) => a.event.division === scope.division)
            .map((a) => eventName(a.event)),
        )].sort(byText);
        if (events.length === 0) {
          leftOut++;
          continue;
        }
        row.push(...events);
      }
      group.push(row);
    }
    rows.push(...group.sort((a, b) => byText(a[0], b[0])));
  }

  const warnings = leftOut > 0
    ? [`${plural(leftOut, "event supervisor")} left out — no Division ${scope.division} events on this track.`]
    : [];
  return { rows, text: toCsv(rows), warnings };
}

// ---------------------------------------------------------------------------
// Email list — whoever the member filters matched, on one line
// ---------------------------------------------------------------------------

export function buildEmailList(members: MembershipFull[]): BuiltinResult {
  const emails = [...new Set(members.map((m) => m.user.email))].sort(byText);
  return { rows: emails.map((email) => [email]), text: emails.join(", "), warnings: [] };
}
