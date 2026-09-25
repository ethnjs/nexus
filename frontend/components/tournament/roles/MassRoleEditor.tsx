"use client";

import { useEffect, useState } from "react";
import { ApiError, MembershipFull, Role, TournamentTrack } from "@/lib/api";
import { userName } from "@/lib/personDisplay";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection } from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/Button";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconPlus, IconMinus, IconX } from "@/components/ui/Icons";
import { RANK_LOCK_REASON } from "@/lib/roles/useMemberRoleLock";
import { NO_SCOPE, WIDE_SCOPE, changeRoleScope, scopeOf, type RoleScope } from "@/lib/roles/roleScope";
import { useTournament } from "@/lib/useTournament";
import { Badge } from "@/components/ui/Badge";
import { RoleScopePill } from "@/components/tournament/roles/RoleScopePill";
import { RolePickerPopover } from "@/components/tournament/roles/RolePickerPopover";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MASS_ROLE_EDITOR_WIDTH = 460;

interface MemberResult {
  membership: MembershipFull;
  error?: string;
}

function ResultsCard({ results }: { results: MemberResult[] }) {
  const failureCount = results.filter((r) => r.error).length;
  const successCount = results.length - failureCount;
  return (
    <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        marginBottom: "10px",
      }}>
        {successCount} saved, {failureCount} failed
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {results.map((r) => (
          <p key={r.membership.id} style={{ fontFamily: "var(--font-sans)", fontSize: "12px" }}>
            <span style={{ fontWeight: 500 }}>{userName(r.membership.user)}</span>{" "}
            {r.error ? (
              <span style={{ color: "var(--color-danger)" }}>— {r.error}</span>
            ) : (
              <span style={{ color: "var(--color-success)" }}>— saved</span>
            )}
          </p>
        ))}
      </div>
    </Card>
  );
}

// A pending role add/remove, shown git-diff style before Save is pressed —
// undoing just drops it back out of the pending set, nothing hits the
// backend until Save. The scope pill edits that draft the same way it edits a
// real grant on the roster, so "where" is decided before the write, not after.
function RoleDiffRow({ role, sign, scope, tracks, onScopeChange, onUndo }: {
  role: Role;
  sign: "+" | "-";
  scope: RoleScope;
  /** Empty in a simple tournament — one track means there is no "where". */
  tracks: TournamentTrack[];
  onScopeChange: (scope: RoleScope) => void;
  onUndo: () => void;
}) {
  const color = sign === "+" ? "var(--color-success)" : "var(--color-danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color }}>{sign}</span>
        <Badge variant={sign === "+" ? "confirmed" : "declined"} className={tracks.length > 0 ? "gap-1.5 pr-1" : ""}>
          {role.label}
          {/* Inside the badge, the way the roster's pill sits inside its chip.
              The badge uppercases its own text; the pill keeps its casing. */}
          {tracks.length > 0 && (
            <span style={{ textTransform: "none", letterSpacing: "normal" }}>
              <RoleScopePill
                scope={scope}
                tracks={tracks}
                title={sign === "+" ? "Where this role applies" : "Where it is removed from"}
                onChange={onScopeChange}
              />
            </span>
          )}
        </Badge>
      </span>
      <Button type="button" variant="ghost" size="xs" iconOnly title="Undo" onClick={onUndo}>
        <IconX size={11} />
      </Button>
    </div>
  );
}

/** Adding to what a member already holds, never replacing it: a member on Day 2
 *  who is granted Day 1 ends up on both. Tournament-wide swallows the rest. */
function withScope(current: RoleScope, added: RoleScope): RoleScope {
  if (current.wide || added.wide) return WIDE_SCOPE;
  return { wide: false, trackIds: [...new Set([...current.trackIds, ...added.trackIds])].sort((a, b) => a - b) };
}

interface MassRoleEditorProps {
  tournamentId: number;
  memberships: MembershipFull[];
  allRoles: Role[];
  /** Role-level rank gate, same as RolesCell — only roles this returns true for are offered here at all, so there's no per-member lock UI to build: a role you can't touch never appears as an option regardless of which member holds it. */
  canTouchRole: (role: Role) => boolean;
  onClose: () => void;
  /** Called once per membership that saved successfully, so the caller can patch its local list the same way RolesCell's onUpdated does. */
  onUpdated: (updated: MembershipFull) => void;
  /** Lets the owning table block selection changes while this panel is dirty. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function MassRoleEditor({ tournamentId, memberships, allRoles, canTouchRole, onClose, onUpdated, onDirtyChange }: MassRoleEditorProps) {
  const { guard } = useUnsavedChanges();

  // Keyed by role, valued by where it applies. "All" on a removal means every
  // scope the member holds it in; on an addition it means tournament-wide.
  const [rolesToAdd, setRolesToAdd] = useState<Map<number, RoleScope>>(new Map());
  const [rolesToRemove, setRolesToRemove] = useState<Map<number, RoleScope>>(new Map());
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<MemberResult[] | null>(null);

  // Every role currently held by at least one selected member — the only
  // ones "Remove role" is meaningful for. Includes roles the actor can't
  // touch too (shown locked, like RolesCell's own picker) rather than
  // hiding them — a role being untouchable is still useful to see.
  const heldRoles = (() => {
    const byId = new Map<number, Role>();
    memberships.forEach((m) => (m.roles ?? []).forEach((r) => byId.set(r.id, r)));
    return [...byId.values()];
  })();

  function rankLockReason(): string {
    return RANK_LOCK_REASON;
  }

  // One track makes "where" a question with one answer, so the pill is left
  // off and every grant is tournament-wide — the roster's own rule.
  const { tracks, isSimple } = useTournament();
  const scopeTracks = isSimple ? [] : tracks;

  const pendingAddRoles = allRoles.filter((r) => rolesToAdd.has(r.id));
  const pendingRemoveRoles = heldRoles.filter((r) => rolesToRemove.has(r.id));

  const isDirty = rolesToAdd.size > 0 || rolesToRemove.size > 0;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  // Checklist popovers stay open across picks, so toggling has to handle
  // both directions (pick to stage, pick again to un-stage) rather than
  // just the one-way "select to add" a plain list would need.
  function toggle(
    set: typeof setRolesToAdd, other: typeof setRolesToAdd, roleId: number,
  ) {
    set((prev) => {
      const next = new Map(prev);
      // Staged at "All" — the safe default to narrow down from, and the only
      // scope a simple tournament has.
      if (next.has(roleId)) next.delete(roleId); else next.set(roleId, WIDE_SCOPE);
      return next;
    });
    other((prev) => {
      if (!prev.has(roleId)) return prev;
      const next = new Map(prev);
      next.delete(roleId);
      return next;
    });
  }

  const toggleAddRole = (role: Role) => toggle(setRolesToAdd, setRolesToRemove, role.id);
  const toggleRemoveRole = (role: Role) => toggle(setRolesToRemove, setRolesToAdd, role.id);

  function setScope(set: typeof setRolesToAdd, roleId: number, scope: RoleScope) {
    set((prev) => new Map(prev).set(roleId, scope));
  }

  function unstage(set: typeof setRolesToAdd, roleId: number) {
    set((prev) => {
      const next = new Map(prev);
      next.delete(roleId);
      return next;
    });
  }

  // Discards the pending changes only — the panel stays open, matching
  // EventPanel/MassEventEditor rather than treating Cancel as a second Close.
  function handleCancel() {
    setRolesToAdd(new Map());
    setRolesToRemove(new Map());
  }

  /** This member's hold on `roleId` right now. */
  function scopeHeld(m: MembershipFull, roleId: number): RoleScope {
    const role = (m.roles ?? []).find((r) => r.id === roleId);
    return role ? scopeOf(role) : NO_SCOPE;
  }

  async function handleSave() {
    setSaving(true);
    setResults(null);

    const outcomes = await Promise.allSettled(memberships.map(async (m) => {
      let latest = m;
      const apply = async (roleId: number, to: RoleScope) => {
        const from = scopeHeld(latest, roleId);
        const saved = await changeRoleScope(tournamentId, m.id, roleId, from, to);
        if (saved) latest = saved;
      };

      for (const [roleId, scope] of rolesToAdd) {
        await apply(roleId, withScope(scopeHeld(latest, roleId), scope));
      }
      for (const [roleId, scope] of rolesToRemove) {
        const from = scopeHeld(latest, roleId);
        if (from.wide && !scope.wide) continue;  // see the note under the rows
        await apply(roleId, scope.wide
          ? NO_SCOPE
          : { wide: false, trackIds: from.trackIds.filter((id) => !scope.trackIds.includes(id)) });
      }
      return latest;
    }));

    const nextResults: MemberResult[] = [];
    outcomes.forEach((outcome, i) => {
      const membership = memberships[i];
      if (outcome.status === "fulfilled") {
        onUpdated(outcome.value);
        nextResults.push({ membership: outcome.value });
      } else {
        const err = outcome.reason;
        nextResults.push({ membership, error: err instanceof ApiError ? err.message : "Failed to save." });
      }
    });
    setResults(nextResults);
    setRolesToAdd(new Map());
    setRolesToRemove(new Map());
    setSaving(false);
  }

  return (
    <DockedPanel
      onClose={() => guard(onClose)}
      width={MASS_ROLE_EDITOR_WIDTH}
      footer={
        <FloatingSaveBar
          visible={isDirty}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      }
    >
      <div style={{ padding: `20px 28px ${isDirty ? "100px" : "20px"}` }}>
        <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
            Edit roles for {memberships.length} members
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            Adding or removing a role only touches that role — every other role each member already holds is left as-is.
          </p>
        </Card>

        <SettingsSection title="Roles">
          <div style={{ padding: "20px 0" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <RolePickerPopover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconPlus size={12} /> Add role
                  </Button>
                }
                roles={allRoles}
                isSelected={(r) => rolesToAdd.has(r.id)}
                isDisabled={(r) => !canTouchRole(r)}
                disabledReason={rankLockReason}
                onToggle={toggleAddRole}
                emptyMessage="No roles yet."
              />
              <RolePickerPopover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconMinus size={12} /> Remove role
                  </Button>
                }
                roles={heldRoles}
                isSelected={(r) => rolesToRemove.has(r.id)}
                isDisabled={(r) => !canTouchRole(r)}
                disabledReason={rankLockReason}
                onToggle={toggleRemoveRole}
                emptyMessage="None of the selected members have a role."
              />
            </div>

            {(pendingAddRoles.length > 0 || pendingRemoveRoles.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                {pendingAddRoles.map((r) => (
                  <RoleDiffRow
                    key={r.id} role={r} sign="+"
                    scope={rolesToAdd.get(r.id) ?? WIDE_SCOPE}
                    tracks={scopeTracks}
                    onScopeChange={(scope) => setScope(setRolesToAdd, r.id, scope)}
                    onUndo={() => unstage(setRolesToAdd, r.id)}
                  />
                ))}
                {pendingRemoveRoles.map((r) => (
                  <RoleDiffRow
                    key={r.id} role={r} sign="-"
                    scope={rolesToRemove.get(r.id) ?? WIDE_SCOPE}
                    tracks={scopeTracks}
                    onScopeChange={(scope) => setScope(setRolesToRemove, r.id, scope)}
                    onUndo={() => unstage(setRolesToRemove, r.id)}
                  />
                ))}
              </div>
            )}

            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              Changes above apply when you press Save — each member is updated independently, so one failing doesn&rsquo;t block the rest.
              {scopeTracks.length > 0 && " Removing from named tracks leaves a member who holds the role across the whole tournament untouched."}
            </p>
          </div>
        </SettingsSection>

        {results && <ResultsCard results={results} />}
      </div>
    </DockedPanel>
  );
}
