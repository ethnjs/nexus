"use client";

import { useEffect, useState } from "react";
import { membershipsApi, ApiError, MembershipSlim, Role } from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection } from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconPlus, IconMinus, IconX } from "@/components/ui/Icons";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MASS_ROLE_EDITOR_WIDTH = 460;

interface MemberResult {
  membership: MembershipSlim;
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
            <span style={{ fontWeight: 500 }}>{personName(r.membership)}</span>{" "}
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
// backend until Save.
function RoleDiffRow({ role, sign, onUndo }: { role: Role; sign: "+" | "-"; onUndo: () => void }) {
  const color = sign === "+" ? "var(--color-success)" : "var(--color-danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color }}>
        {sign} {role.label}
      </span>
      <Button type="button" variant="ghost" size="xs" iconOnly title="Undo" onClick={onUndo}>
        <IconX size={11} />
      </Button>
    </div>
  );
}

interface MassRoleEditorProps {
  tournamentId: number;
  memberships: MembershipSlim[];
  allRoles: Role[];
  /** Role-level rank gate, same as RolesCell — only roles this returns true for are offered here at all, so there's no per-member lock UI to build: a role you can't touch never appears as an option regardless of which member holds it. */
  canTouchRole: (role: Role) => boolean;
  onClose: () => void;
  /** Called once per membership that saved successfully, so the caller can patch its local list the same way RolesCell's onUpdated does. */
  onUpdated: (updated: MembershipSlim) => void;
  /** Lets the owning table block selection changes while this panel is dirty. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function MassRoleEditor({ tournamentId, memberships, allRoles, canTouchRole, onClose, onUpdated, onDirtyChange }: MassRoleEditorProps) {
  const { guard } = useUnsavedChanges();

  const [rolesToAdd, setRolesToAdd] = useState<Set<number>>(new Set());
  const [rolesToRemove, setRolesToRemove] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<MemberResult[] | null>(null);

  // Every role currently held by at least one selected member — the only
  // ones "Remove role" is meaningful for. Includes roles the actor can't
  // touch too (shown locked, like RolesCell's own picker) rather than
  // hiding them — a role being untouchable is still useful to see.
  const heldRoles = (() => {
    const byId = new Map<number, Role>();
    memberships.forEach((m) => m.roles.forEach((r) => byId.set(r.id, r)));
    return [...byId.values()];
  })();

  function rankLockReason(): string {
    return "You can't touch a role that ties or outranks your own highest role.";
  }

  const pendingAddRoles = allRoles.filter((r) => rolesToAdd.has(r.id));
  const pendingRemoveRoles = heldRoles.filter((r) => rolesToRemove.has(r.id));

  const isDirty = rolesToAdd.size > 0 || rolesToRemove.size > 0;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  // Checklist popovers stay open across picks, so toggling has to handle
  // both directions (pick to stage, pick again to un-stage) rather than
  // just the one-way "select to add" a plain list would need.
  function toggleAddRole(role: Role) {
    setRolesToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(role.id)) next.delete(role.id); else next.add(role.id);
      return next;
    });
    setRolesToRemove((prev) => (prev.has(role.id) ? new Set([...prev].filter((id) => id !== role.id)) : prev));
  }

  function toggleRemoveRole(role: Role) {
    setRolesToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(role.id)) next.delete(role.id); else next.add(role.id);
      return next;
    });
    setRolesToAdd((prev) => (prev.has(role.id) ? new Set([...prev].filter((id) => id !== role.id)) : prev));
  }

  // Discards the pending changes only — the panel stays open, matching
  // EventPanel/MassEventEditor rather than treating Cancel as a second Close.
  function handleCancel() {
    setRolesToAdd(new Set());
    setRolesToRemove(new Set());
  }

  async function handleSave() {
    setSaving(true);
    setResults(null);

    const outcomes = await Promise.allSettled(memberships.map(async (m) => {
      const heldIds = new Set(m.roles.map((r) => r.id));
      const add = [...rolesToAdd].filter((id) => !heldIds.has(id));
      const remove = [...rolesToRemove].filter((id) => heldIds.has(id));
      if (add.length === 0 && remove.length === 0) return m;
      return membershipsApi.updateRoles(tournamentId, m.id, {
        add: add.length > 0 ? add : undefined,
        remove: remove.length > 0 ? remove : undefined,
      });
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
    setRolesToAdd(new Set());
    setRolesToRemove(new Set());
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
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconPlus size={12} /> Add role
                  </Button>
                }
                items={allRoles}
                getKey={(r) => r.id}
                renderLabel={(r) => r.label}
                emptyMessage="No roles yet."
                onSelect={toggleAddRole}
                checklist
                isSelected={(r) => rolesToAdd.has(r.id)}
                isDisabled={(r) => !canTouchRole(r)}
                disabledReason={rankLockReason}
                width={240}
              />
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconMinus size={12} /> Remove role
                  </Button>
                }
                items={heldRoles}
                getKey={(r) => r.id}
                renderLabel={(r) => r.label}
                emptyMessage="None of the selected members have a role."
                onSelect={toggleRemoveRole}
                checklist
                isDisabled={(r) => !canTouchRole(r)}
                disabledReason={rankLockReason}
                isSelected={(r) => rolesToRemove.has(r.id)}
                width={240}
              />
            </div>

            {(pendingAddRoles.length > 0 || pendingRemoveRoles.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                {pendingAddRoles.map((r) => (
                  <RoleDiffRow key={r.id} role={r} sign="+" onUndo={() => setRolesToAdd((prev) => new Set([...prev].filter((id) => id !== r.id)))} />
                ))}
                {pendingRemoveRoles.map((r) => (
                  <RoleDiffRow key={r.id} role={r} sign="-" onUndo={() => setRolesToRemove((prev) => new Set([...prev].filter((id) => id !== r.id)))} />
                ))}
              </div>
            )}

            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              Changes above apply when you press Save — each member is updated independently, so one failing doesn&rsquo;t block the rest.
            </p>
          </div>
        </SettingsSection>

        {results && <ResultsCard results={results} />}
      </div>
    </DockedPanel>
  );
}
