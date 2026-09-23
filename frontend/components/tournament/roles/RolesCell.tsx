"use client";

import {
  ApiError, MembershipFull, MembershipView, MemberRole, Role, TournamentTrack,
} from "@/lib/api";
import { userName } from "@/lib/personDisplay";
import { useToast } from "@/lib/useToast";
import { useTournament } from "@/lib/useTournament";
import { RANK_LOCK_REASON } from "@/lib/roles/useMemberRoleLock";
import {
  NO_SCOPE, WIDE_SCOPE, changeRoleScope, scopeOf, type RoleScope,
} from "@/lib/roles/roleScope";
import { ChipInput } from "@/components/ui/ChipInput";
import { FieldValue } from "@/components/profile/PanelField";
import { Button } from "@/components/ui/Button";
import { IconLock, IconPlus } from "@/components/ui/Icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { RolePickerPopover } from "@/components/tournament/roles/RolePickerPopover";
import { RoleScopePill } from "@/components/tournament/roles/RoleScopePill";

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
  /** Why `locked` is set, when it is something the viewer could act on — the
      add control then stays put as a lock with this as its tooltip, instead of
      vanishing and leaving nothing to explain itself. */
  lockedReason?: string;
  /** What to render instead of an empty chip row when the cell is inert — a
      panel field wants to say "None", a table cell would rather stay blank. */
  emptyLabel?: string;
  onUpdated: (updated: MembershipFull) => void;
}

// Inline role editor — chips for held roles (removable), and a way to add
// more. Shared between the roster table and the member detail panel.
//
// One track means "held on the tournament" and "held on that track" are the
// same thing, so a simple tournament gets plain chips and a plain checklist,
// always granting tournament-wide. With several, each chip says where it is
// held, and a role is added in two steps: which role, then where.
export function RolesCell({
  tournamentId, membership, allRoles, canTouchRole, locked, lockedReason, readOnly = false, emptyLabel, onUpdated,
}: RolesCellProps) {
  // Two different reasons the chips go inert; ChipInput only has the one knob.
  const inert = locked || readOnly;
  // Locked for a reason worth showing: the controls stay, wearing a lock. The
  // panel's readOnly isn't one — the same roles are editable a few pixels away.
  const explained = locked && !readOnly && !!lockedReason;
  const { show } = useToast();
  const { tracks, isSimple } = useTournament();
  const memberName = userName(membership.user);

  const held: MemberRole[] = membership.roles ?? [];
  const heldIds = new Set(held.map((r) => r.id));
  const roleByLabel = new Map(held.map((r) => [r.label, r]));

  // Inert with no chips and no add button is a blank cell, which reads as
  // "still loading" rather than "holds no roles".
  if (inert && !explained && held.length === 0 && emptyLabel) {
    return <FieldValue muted>{emptyLabel}</FieldValue>;
  }

  function rankLockReason(role: Role): string | undefined {
    return canTouchRole(role) ? undefined : RANK_LOCK_REASON;
  }

  /** Moves a role from one scope to another and reports it. Throws on failure,
   *  for callers that show the error themselves (a popover form). */
  async function changeScope(role: Role, from: RoleScope, to: RoleScope) {
    const updated = await changeRoleScope(tournamentId, membership.id, role.id, from, to);
    if (updated) onUpdated(updated);
    return updated;
  }

  async function handleRemove(role: MemberRole) {
    try {
      await changeScope(role, scopeOf(role), NO_SCOPE);
      show(`Removed ${role.label} from ${memberName}`);
    } catch (err: unknown) {
      show(err instanceof ApiError ? err.message : "Failed to remove role.", "error");
    }
  }

  async function handleAdd(role: Role, scope: RoleScope) {
    await changeScope(role, NO_SCOPE, scope);
    show(`Added ${role.label} to ${memberName}`);
  }

  const addButton = (
    <Button
      type="button" variant="secondary" size="sm" iconOnly
      title="Edit roles"
      style={{ padding: 0, flexShrink: 0 }}
    >
      <IconPlus size={14} />
    </Button>
  );

  return (
    <ChipInput
      value={held.map((r) => r.label)}
      onChange={(labels) => {
        const removed = held.find((r) => !labels.includes(r.label));
        if (removed) handleRemove(removed);
      }}
      variant="transparent"
      size="sm"
      disableInput
      // Explained locks stay unlocked *to ChipInput*: a locked field drops
      // every affordance, and the lock icons below are the affordance.
      locked={inert && !explained}
      chipLockReason={(label: string) => {
        if (explained) return lockedReason;
        const role = roleByLabel.get(label);
        return role ? rankLockReason(role) : undefined;
      }}
      renderChipTrailing={isSimple ? undefined : (label) => {
        const role = roleByLabel.get(label);
        if (!role) return null;
        return (
          <RoleScopePill
            scope={scopeOf(role)}
            tracks={tracks}
            editable={!inert && canTouchRole(role)}
            title="Where this role applies"
            onChange={async (scope) => {
              await changeScope(role, scopeOf(role), scope);
              show(`Updated ${role.label} for ${memberName}`);
            }}
          />
        );
      }}
      fullWidth
      // One list for both kinds of tournament: every role, the held ones
      // ticked. Ticking grants tournament-wide; on a multi-track tournament
      // the chip's scope pill narrows it afterwards. Rank locks show as a
      // lock icon in place of the checkbox, same rule either way.
      addButton={explained ? (
        <Tooltip variant="info" message={lockedReason!} showIcon={false}>
          <Button type="button" variant="secondary" size="sm" iconOnly disabled title={lockedReason} style={{ padding: 0, flexShrink: 0 }}>
            <IconLock size={12} />
          </Button>
        </Tooltip>
      ) : (
        <RolePickerPopover
          trigger={addButton}
          roles={allRoles}
          isSelected={(role) => heldIds.has(role.id)}
          isDisabled={(role) => !canTouchRole(role)}
          disabledReason={rankLockReason}
          onSelect={(role) => {
            const current = held.find((r) => r.id === role.id);
            return current ? handleRemove(current) : handleAdd(role, WIDE_SCOPE);
          }}
          emptyMessage="No roles yet"
        />
      )}
    />
  );
}
