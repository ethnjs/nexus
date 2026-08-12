"use client";

import { ApiError, MembershipSlim, membershipsApi, Role } from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { useToast } from "@/lib/useToast";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";

interface RolesCellProps {
  tournamentId: number;
  membership: MembershipSlim;
  allRoles: Role[];
  /** Role-level rank gate — whether `role` can be added or removed at all (independent of which member holds it). */
  canTouchRole: (role: Role) => boolean;
  /** Member-level gate — false hides the add control and every chip's remove "x", e.g. tournament archived or this member's own roles outrank the actor. */
  locked: boolean;
  onUpdated: (updated: MembershipSlim) => void;
}

// Inline role editor — chips for held roles (removable), a checklist
// popover to add/remove more. Shared between the roster table and the
// member detail panel.
export function RolesCell({ tournamentId, membership, allRoles, canTouchRole, locked, onUpdated }: RolesCellProps) {
  const { show } = useToast();
  const memberName = personName(membership.user);

  const heldIds = new Set(membership.roles.map((r) => r.id));

  async function handleRemove(role: Role) {
    try {
      const updated = await membershipsApi.updateRoles(tournamentId, membership.id, { remove: [role.id] });
      onUpdated(updated);
      show(`Removed ${role.label} from ${memberName}`);
    } catch (err: unknown) {
      show(err instanceof ApiError ? err.message : "Failed to remove role.", "error");
    }
  }

  async function handleAdd(role: Role) {
    const updated = await membershipsApi.updateRoles(tournamentId, membership.id, { add: [role.id] });
    onUpdated(updated);
    show(`Added ${role.label} to ${memberName}`);
  }

  return (
    <ChipInput
      value={membership.roles.map((r) => r.label)}
      onChange={(labels) => {
        const removed = membership.roles.find((r) => !labels.includes(r.label));
        if (removed) handleRemove(removed);
      }}
      variant="transparent"
      size="sm"
      disableInput
      locked={locked}
      fullWidth
      addButton={
        !locked && (
          <Popover
            trigger={
              <Button
                type="button" variant="secondary" size="sm" iconOnly
                title="Edit roles"
                style={{ padding: 0, flexShrink: 0 }}
              >
                <IconPlus size={14} />
              </Button>
            }
            items={allRoles}
            getKey={(role) => role.id}
            renderLabel={(role) => role.label}
            checklist
            isSelected={(role) => heldIds.has(role.id)}
            isDisabled={(role) => !canTouchRole(role)}
            onSelect={(role) => (heldIds.has(role.id) ? handleRemove(role) : handleAdd(role))}
            emptyMessage="No roles yet"
          />
        )
      }
    />
  );
}
