import type { DuosmiumRole, Role, TorusRole } from "@/lib/api";

// What a role can be in each external system the exports feed (#108). The
// role editor's dropdowns, the audit log and the export presets all read this.

export interface ExternalRoleInfo {
  label:       string;
  // Exported per event (`[event], email`) rather than as a bare email.
  eventScoped: boolean;
  // Duosmium's own short code for the role (TD/SM/ES).
  code?:       string;
}

// Record<Union, …> rather than a list: adding a value to the union is a type
// error here until it gets a label.
const TORUS_ROLES: Record<TorusRole, ExternalRoleInfo> = {
  writer:              { label: "Test Writer",         eventScoped: true },
  reviewer:            { label: "Test Reviewer",       eventScoped: true },
  tournament_director: { label: "Tournament Director", eventScoped: false },
  test_coordinator:    { label: "Test Coordinator",    eventScoped: false },
};

const DUOSMIUM_ROLES: Record<DuosmiumRole, ExternalRoleInfo> = {
  tournament_director: { label: "Tournament Director", eventScoped: false, code: "TD" },
  scoremaster:         { label: "Scoremaster",         eventScoped: false, code: "SM" },
  event_supervisor:    { label: "Event Supervisor",    eventScoped: true,  code: "ES" },
};

export type ExternalRoleField = "torus_role" | "duosmium_role";

export interface ExternalSystem {
  label: string;
  field: ExternalRoleField;
  roles: Record<string, ExternalRoleInfo>;
}

export const EXTERNAL_SYSTEMS: readonly ExternalSystem[] = [
  { label: "TORUS",    field: "torus_role",    roles: TORUS_ROLES },
  { label: "Duosmium", field: "duosmium_role", roles: DUOSMIUM_ROLES },
];

export const EXTERNAL_ROLE_FIELDS = EXTERNAL_SYSTEMS.map((s) => s.field);

export function externalSystemFor(field: string): ExternalSystem | undefined {
  return EXTERNAL_SYSTEMS.find((s) => s.field === field);
}

/** The display label for a stored value, or "None" for null. Falls back to
 *  the raw value for one this build doesn't know (e.g. an old audit entry). */
export function externalRoleLabel(field: ExternalRoleField, value: string | null | undefined): string {
  if (!value) return "None";
  return externalSystemFor(field)?.roles[value]?.label ?? value;
}

export type ExternalRoleValues = Pick<Role, ExternalRoleField>;
