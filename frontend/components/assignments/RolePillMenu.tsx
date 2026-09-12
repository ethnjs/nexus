"use client";

import { useState } from "react";

import { PillMenu } from "@/components/ui/PillMenu";
import { Toggle } from "@/components/ui/Toggle";
import { Role } from "@/lib/api";
import { roleSummary, sameRole, type AssignmentRole } from "@/lib/assignments/lanes";

/**
 * The role picker on an assignment chip — on the board, where a chip is a
 * person, and in a member's panel, where it is an event. Same question either
 * way: which roles is this placement for.
 *
 * List mode by default, where a click *replaces* the set. Swapping a role is
 * far commoner than stacking one, and in checklist mode that meant ticking
 * the new role and then unticking the old — with the last-role lock making
 * even the order matter. "Select multiple" brings the checkboxes back for the
 * rarer case.
 */
export function RolePillMenu({ roles, roleCatalog, onToggleRole, onPickRole }: {
  /** The roles this chip currently carries. */
  roles: AssignmentRole[];
  /** Every role the tournament offers. */
  roleCatalog: Role[];
  /** Adds or removes one, leaving the rest — the multi-select path. */
  onToggleRole: (role: AssignmentRole) => void;
  /** Replaces the whole set with this one — the default path. */
  onPickRole: (role: AssignmentRole) => void;
}) {
  // Reset on every opening, from the chip itself: a chip already holding
  // several roles opens with checkboxes, since a plain click would replace them.
  const [multi, setMulti] = useState(false);

  return (
    <PillMenu
      onOpenChange={(open) => { if (open) setMulti(roles.length > 1); }}
      label={roleSummary(roles)}
      tone={roles.length > 0 ? "default" : "muted"}
      items={roleCatalog}
      getKey={(role) => role.id}
      renderLabel={(role) => role.label}
      header={
        <label style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "8px", padding: "2px 4px", cursor: "pointer",
        }}>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500,
            color: "var(--color-text-secondary)",
          }}>
            Select multiple
          </span>
          <Toggle checked={multi} onChange={setMulti} />
        </label>
      }
      checklist={multi}
      isSelected={(role) => roles.some((r) => sameRole(r, role))}
      // Only in checklist mode: clearing the last role would delete the
      // assignment outright, and a menu that says "roles" should not be able
      // to unassign someone. Picking in list mode replaces the set rather
      // than emptying it, so nothing needs locking.
      isDisabled={multi ? (role) => roles.length === 1 && sameRole(roles[0], role) : undefined}
      disabledReason={() => "Add another role before removing this one"}
      onSelect={multi ? onToggleRole : onPickRole}
      width={200}
      align="left"
    />
  );
}
