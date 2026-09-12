"use client";

import { ApiError, MembershipFull, MembershipView, membersApi, Role } from "@/lib/api";
import { userName } from "@/lib/personDisplay";
import { useAuth } from "@/lib/useAuth";
import { useToast } from "@/lib/useToast";
import { ChipInput } from "@/components/ui/ChipInput";
import { FieldValue } from "@/components/profile/PanelField";
import { Popover } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";

interface RolesCellProps {
  tournamentId: number;
  membership: MembershipView;
  allRoles: Role[];
  /** Role-level rank gate — whether `role` can be added or removed at all (independent of which member holds it). */
  canTouchRole: (role: Role) => boolean;
  /** Member-level gate — false hides the add control and every chip's remove "x" entirely, e.g. tournament archived or this member's own roles outrank the actor. Independent of canTouchRole: when the member IS editable, individual chips still lock (with a lock icon in place of "x") for roles that tie or outrank the actor's own rank. */
  locked: boolean;
  /**
   * Suppress the interactive controls without implying the member *can't* be
   * edited — used for the one table row whose roles are currently open in the
   * docked panel, so the same roles aren't editable in two places at once.
   */
  readOnly?: boolean;
  /** What to render instead of an empty chip row when the cell is inert — a
      panel field wants to say "None", a table cell would rather stay blank. */
  emptyLabel?: string;
  onUpdated: (updated: MembershipFull) => void;
}

// Inline role editor — chips for held roles (removable), a checklist
// popover to add/remove more. Shared between the roster table and the
// member detail panel.
export function RolesCell({
  tournamentId, membership, allRoles, canTouchRole, locked, readOnly = false, emptyLabel, onUpdated,
}: RolesCellProps) {
  // Two different reasons the chips go inert; ChipInput only has the one knob.
  const inert = locked || readOnly;
  const { show } = useToast();
  const { user: currentUser } = useAuth();
  const memberName = userName(membership.user);
  const isSelf = currentUser?.id === membership.user.id;

  const heldIds = new Set((membership.roles ?? []).map((r) => r.id));
  const roleByLabel = new Map((membership.roles ?? []).map((r) => [r.label, r]));

  // Inert with no chips and no add button is a blank cell, which reads as
  // "still loading" rather than "holds no roles".
  if (inert && (membership.roles ?? []).length === 0 && emptyLabel) {
    return <FieldValue muted>{emptyLabel}</FieldValue>;
  }

  function rankLockReason(role: Role): string | undefined {
    if (canTouchRole(role)) return undefined;
    return isSelf
      ? "You can't remove your own highest-ranked role."
      : "You can't touch a role that ties or outranks your own highest role.";
  }

  async function handleRemove(role: Role) {
    try {
      const updated = await membersApi.updateRoles(tournamentId, membership.id, { remove: [role.id] });
      onUpdated(updated);
      show(`Removed ${role.label} from ${memberName}`);
    } catch (err: unknown) {
      show(err instanceof ApiError ? err.message : "Failed to remove role.", "error");
    }
  }

  async function handleAdd(role: Role) {
    const updated = await membersApi.updateRoles(tournamentId, membership.id, { add: [role.id] });
    onUpdated(updated);
    show(`Added ${role.label} to ${memberName}`);
  }

  return (
    <ChipInput
      value={(membership.roles ?? []).map((r) => r.label)}
      onChange={(labels) => {
        const removed = (membership.roles ?? []).find((r) => !labels.includes(r.label));
        if (removed) handleRemove(removed);
      }}
      variant="transparent"
      size="sm"
      disableInput
      locked={inert}
      chipLockReason={(label: string) => {
        const role = roleByLabel.get(label);
        return role ? rankLockReason(role) : undefined;
      }}
      fullWidth
      addButton={
        !inert && (
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
            disabledReason={rankLockReason}
            onSelect={(role) => (heldIds.has(role.id) ? handleRemove(role) : handleAdd(role))}
            emptyMessage="No roles yet"
          />
        )
      }
    />
  );
}
