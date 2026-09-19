"use client";

import { useState } from "react";
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
import { Popover } from "@/components/ui/Popover";
import { FormPopover } from "@/components/ui/FormPopover";
import { Button } from "@/components/ui/Button";
import { IconLock, IconPlus } from "@/components/ui/Icons";
import { RoleScopeForm } from "@/components/tournament/RoleScopePicker";

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

/** "All", a track's name, or a count once names would crowd the chip. */
function scopeLabel(scope: RoleScope, tracks: TournamentTrack[]): string {
  if (scope.wide) return "All";
  const names = scope.trackIds.map((id) => tracks.find((t) => t.id === id)?.name ?? "?");
  return names.length <= 2 ? names.join(", ") : `${names.length} tracks`;
}

// Inline role editor — chips for held roles (removable), and a way to add
// more. Shared between the roster table and the member detail panel.
//
// One track means "held on the tournament" and "held on that track" are the
// same thing, so a simple tournament gets plain chips and a plain checklist,
// always granting tournament-wide. With several, each chip says where it is
// held, and a role is added in two steps: which role, then where.
export function RolesCell({
  tournamentId, membership, allRoles, canTouchRole, locked, readOnly = false, emptyLabel, onUpdated,
}: RolesCellProps) {
  // Two different reasons the chips go inert; ChipInput only has the one knob.
  const inert = locked || readOnly;
  const { show } = useToast();
  const { tracks, isSimple } = useTournament();
  const memberName = userName(membership.user);

  const held: MemberRole[] = membership.roles ?? [];
  const heldIds = new Set(held.map((r) => r.id));
  const roleByLabel = new Map(held.map((r) => [r.label, r]));

  // Inert with no chips and no add button is a blank cell, which reads as
  // "still loading" rather than "holds no roles".
  if (inert && held.length === 0 && emptyLabel) {
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
      locked={inert}
      chipLockReason={(label: string) => {
        const role = roleByLabel.get(label);
        return role ? rankLockReason(role) : undefined;
      }}
      renderChipTrailing={isSimple ? undefined : (label) => {
        const role = roleByLabel.get(label);
        if (!role) return null;
        return (
          <ScopePill
            role={role}
            tracks={tracks}
            editable={!inert && canTouchRole(role)}
            onApply={async (scope) => {
              await changeScope(role, scopeOf(role), scope);
              show(`Updated ${role.label} for ${memberName}`);
            }}
          />
        );
      }}
      fullWidth
      addButton={isSimple ? (
        <Popover
          trigger={addButton}
          items={allRoles}
          getKey={(role) => role.id}
          renderLabel={(role) => role.label}
          checklist
          isSelected={(role) => heldIds.has(role.id)}
          isDisabled={(role) => !canTouchRole(role)}
          disabledReason={rankLockReason}
          onSelect={(role) => {
            const current = held.find((r) => r.id === role.id);
            return current ? handleRemove(current) : handleAdd(role, WIDE_SCOPE);
          }}
          emptyMessage="No roles yet"
        />
      ) : (
        <FormPopover trigger={addButton} width={260}>
          {(close) => (
            <AddRoleSteps
              roles={allRoles.filter((r) => !heldIds.has(r.id))}
              tracks={tracks}
              canTouchRole={canTouchRole}
              rankLockReason={rankLockReason}
              onAdd={async (role, scope) => { await handleAdd(role, scope); close(); }}
              onCancel={close}
            />
          )}
        </FormPopover>
      )}
    />
  );
}

/** Where a role is held, on its chip. Opens the scope picker when the viewer
 *  can change it; plain text when they can't. */
function ScopePill({ role, tracks, editable, onApply }: {
  role: MemberRole;
  tracks: TournamentTrack[];
  editable: boolean;
  onApply: (scope: RoleScope) => Promise<void>;
}) {
  const scope = scopeOf(role);
  const label = scopeLabel(scope, tracks);
  const pillStyle = {
    fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
    letterSpacing: "0.03em", textTransform: "uppercase" as const,
    padding: "0 5px", borderRadius: "var(--radius-sm)",
    background: "var(--color-surface)", color: "var(--color-text-secondary)",
    border: "1px solid var(--color-border)", lineHeight: "14px", whiteSpace: "nowrap" as const,
  };
  if (!editable) return <span style={pillStyle}>{label}</span>;

  return (
    <FormPopover
      width={260}
      align="left"
      trigger={
        <button type="button" title="Where this role applies" style={{ ...pillStyle, cursor: "pointer" }}>
          {label}
        </button>
      }
    >
      {(close) => (
        <RoleScopeForm
          tracks={tracks}
          initial={scope}
          applyLabel="Save"
          onApply={async (next) => { await onApply(next); close(); }}
          onCancel={close}
        />
      )}
    </FormPopover>
  );
}

/** The add flow's two steps: pick a role, then say where it applies. */
function AddRoleSteps({ roles, tracks, canTouchRole, rankLockReason, onAdd, onCancel }: {
  roles: Role[];
  tracks: TournamentTrack[];
  canTouchRole: (role: Role) => boolean;
  rankLockReason: (role: Role) => string | undefined;
  onAdd: (role: Role, scope: RoleScope) => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<Role | null>(null);

  if (role) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
        }}>
          {role.label} applies to
        </div>
        <RoleScopeForm
          tracks={tracks}
          initial={NO_SCOPE}
          applyLabel="Add role"
          onApply={(scope) => onAdd(role, scope)}
          onCancel={() => setRole(null)}
        />
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", margin: 0 }}>
        No more roles to add.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {roles.map((r) => {
        const allowed = canTouchRole(r);
        return (
          <Button
            key={r.id}
            type="button" variant="ghost" size="sm" fullWidth
            disabled={!allowed}
            title={allowed ? undefined : rankLockReason(r)}
            onClick={() => setRole(r)}
            style={{ justifyContent: "space-between" }}
          >
            {r.label}
            {!allowed && <IconLock size={11} />}
          </Button>
        );
      })}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
