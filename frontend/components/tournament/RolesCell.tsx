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
import { Pill, PillMenu } from "@/components/ui/PillMenu";
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
          <ScopePillMenu
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

/** Where a role is held, on its chip: a checklist of "Whole tournament" plus
 *  every track, saved per click. Plain text when the viewer can't change it. */
function ScopePillMenu({ role, tracks, editable, onApply }: {
  role: MemberRole;
  tracks: TournamentTrack[];
  editable: boolean;
  onApply: (scope: RoleScope) => Promise<void>;
}) {
  const scope = scopeOf(role);
  const label = scopeLabel(scope, tracks);
  if (!editable) return <Pill label={label} title="Where this role applies" />;

  const options: ScopeOption[] = [WIDE_OPTION, ...tracks.map((t) => ({ kind: "track" as const, track: t }))];

  return (
    <PillMenu
      label={label}
      items={options}
      getKey={(o) => (o.kind === "wide" ? "wide" : o.track.id)}
      renderLabel={(o) => (o.kind === "wide" ? "Whole tournament" : o.track.name)}
      checklist
      isSelected={(o) => (o.kind === "wide" ? scope.wide : scope.trackIds.includes(o.track.id))}
      // Unticking the only thing ticked would leave an empty scope, which is
      // how the role gets removed — not something a menu about *where* should do.
      isDisabled={(o) => (o.kind === "wide"
        ? scope.wide
        : !scope.wide && scope.trackIds.length === 1 && scope.trackIds[0] === o.track.id)}
      disabledReason={() => "Pick somewhere else first"}
      onSelect={(o) => onApply(nextScope(scope, o))}
      width={200}
      align="left"
    />
  );
}

type ScopeOption = { kind: "wide" } | { kind: "track"; track: TournamentTrack };
const WIDE_OPTION: ScopeOption = { kind: "wide" };

/** Clicking "Whole tournament" replaces any tracks with it; clicking a track
 *  while tournament-wide narrows to just that track (the two can't coexist —
 *  a ticked track beside "whole tournament" reads as the narrower claim). */
function nextScope(scope: RoleScope, option: ScopeOption): RoleScope {
  if (option.kind === "wide") return WIDE_SCOPE;
  const id = option.track.id;
  if (scope.wide) return { wide: false, trackIds: [id] };
  return {
    wide: false,
    trackIds: scope.trackIds.includes(id)
      ? scope.trackIds.filter((x) => x !== id)
      : [...scope.trackIds, id].sort((a, b) => a - b),
  };
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
