"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DndContext } from "@dnd-kit/core";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { rolesApi, ApiError, Permission, Role, RoleWithMemberCount } from "@/lib/api";
import { useRoleReorder, useRoleRowDrag } from "@/lib/roles/useRoleReorder";
import { defaultNewRoleLabel, isTempRole, isTempRoleId, nextBottomRank, rankChanges } from "@/lib/roles/roleReorder";
import { useRoleLock } from "@/lib/roles/useRoleLock";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { RoleDropDivider } from "@/components/tournament/settings/RoleDropDivider";
import { RoleMembersTab } from "@/components/tournament/settings/RoleMembersTab";
import { RoleDraft, RoleEditorForm } from "@/components/tournament/settings/RoleEditorForm";
import { IconArrowLeft, IconLock, IconPlus, IconUserShield } from "@/components/ui/Icons";

function draftDiffers(draft: RoleDraft, role: Role): boolean {
  return draft.label.trim() !== role.label
    || JSON.stringify([...draft.permissions].sort()) !== JSON.stringify([...role.permissions].sort());
}

export default function RoleEditorPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tournamentId = Number(params.id);
  const editorPath = `/dashboard/tournaments/${tournamentId}/settings/roles/edit`;

  const { canManageRoles, canCreateRoles, membershipLoading, lockReason, isLocked } = useRoleLock();

  // Holds real (server) roles plus any unsaved temp-id drafts, in one list, so
  // the nav rail and the reorder hook need no notion of "not created yet".
  const [roles, setRoles] = useState<RoleWithMemberCount[] | null>(null);

  // Which role is open — local state, not a route param, so switching roles
  // never remounts anything and can't lose a draft. Seeded once from ?role=
  // so links elsewhere (the index page's row buttons) can still deep-link in.
  const [activeRoleId, setActiveRoleId] = useState<number | null>(() => {
    const fromQuery = Number(searchParams.get("role"));
    return Number.isFinite(fromQuery) && fromQuery > 0 ? fromQuery : null;
  });
  const [activeTab, setActiveTab] = useState<"details" | "members">("details");

  // ?role=new means "open with a fresh unsaved role". Deferred until the list
  // has loaded, since the default label and rank are derived from it.
  const pendingNewRoleRef = useRef(searchParams.get("role") === "new");

  // The server list is authoritative for real roles, but unsaved temp drafts
  // have to survive a refetch — except the ones whose create just landed, which
  // the caller identifies by temp id.
  const refreshRoles = useCallback(async (createdTempIds?: Set<number>) => {
    const next = await rolesApi.list(tournamentId).catch(() => []);
    setRoles((cur) => {
      const temps = (cur ?? []).filter((r) => isTempRole(r) && !createdTempIds?.has(r.id));
      return temps.length > 0 ? [...next, ...temps] : next;
    });
  }, [tournamentId]);

  // Fetched once — switching the active role never re-triggers this.
  useEffect(() => {
    refreshRoles();
  }, [tournamentId, refreshRoles]);

  // Sourced from the roles list itself (member_count is computed server-side)
  // rather than a separate memberships fetch — one GET instead of two.
  const memberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const r of roles ?? []) counts[r.id] = r.member_count;
    return counts;
  }, [roles]);

  // The index page already shows a locked "No access" state for this — send
  // anyone without manage_roles back there instead of letting them sit here.
  useEffect(() => {
    if (!membershipLoading && !canManageRoles) {
      router.replace(`/dashboard/tournaments/${tournamentId}/settings/roles`);
    }
  }, [membershipLoading, canManageRoles, router, tournamentId]);

  // The hook's onSaved is typed generically as Role[], but it only ever
  // spreads the RoleWithMemberCount objects we passed in, so member_count
  // survives at runtime — the cast just corrects the narrowed type.
  const reorder = useRoleReorder({
    tournamentId, roles, isLocked,
    onSaved: (updated) => setRoles(updated as RoleWithMemberCount[]),
  });

  // Field drafts for every role touched, not just the open one — switching
  // roles is local state now, so this would survive either way, but it's
  // still keyed by id since edits to several roles can be pending at once.
  const [drafts, setDrafts] = useState<Record<number, RoleDraft>>({});
  const [fieldSaving, setFieldSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  const rolesRef = useRef<Role[] | null>(roles);
  rolesRef.current = roles;

  // Decrements per unsaved role created this session, so temp ids stay unique
  // among themselves and can never collide with a real (positive) id.
  const nextTempIdRef = useRef(-1);

  // A temp role has no server baseline to diff against — the whole thing is
  // unsaved — so its fields live in `roles` itself rather than in `drafts`.
  const draftFor = useCallback((role: Role): RoleDraft => (
    isTempRole(role)
      ? { label: role.label, permissions: role.permissions as Permission[] }
      : drafts[role.id] ?? { label: role.label, permissions: role.permissions as Permission[] }
  ), [drafts]);

  const setDraft = useCallback((roleId: number, patch: Partial<RoleDraft>) => {
    if (isTempRoleId(roleId)) {
      setRoles((cur) => cur?.map((r) => (r.id === roleId ? { ...r, ...patch } : r)) ?? cur);
      return;
    }
    setDrafts((cur) => {
      const role = rolesRef.current?.find((r) => r.id === roleId);
      if (!role) return cur;
      const base = cur[roleId] ?? { label: role.label, permissions: role.permissions as Permission[] };
      return { ...cur, [roleId]: { ...base, ...patch } };
    });
  }, []);

  // Drop drafts for roles that no longer exist (deleted while editing).
  useEffect(() => {
    if (!roles) return;
    setDrafts((cur) => {
      const ids = new Set(roles.map((r) => r.id));
      const kept = Object.entries(cur).filter(([id]) => ids.has(Number(id)));
      return kept.length === Object.keys(cur).length ? cur : Object.fromEntries(kept);
    });
  }, [roles]);

  const pendingEdits = useMemo(
    () => (roles ?? []).filter((r) => drafts[r.id] && draftDiffers(drafts[r.id], r)),
    [roles, drafts],
  );

  const tempRoles = useMemo(() => (roles ?? []).filter(isTempRole), [roles]);

  const isDirty = reorder.isDirty || pendingEdits.length > 0 || tempRoles.length > 0;
  const saving = reorder.saving || fieldSaving;
  const error = reorder.error ?? fieldError;

  // Reorder, new roles, and every pending field edit commit together — the save
  // bar is shared, so Save means "save everything I've changed anywhere in here".
  // None of the three depends on another, so they go out in one batch.
  async function handleSaveAll() {
    setFieldError(undefined);
    const edits = pendingEdits;
    const temps = tempRoles;
    setFieldSaving(true);
    let saved = false;

    // The drag computation runs over the whole list, temp ids included, so a new
    // role dropped mid-list already has its final rank here. The backend has
    // never heard of that id though, so it's dropped from the reorder payload
    // and passed to create() instead; the real roles it displaced still go
    // through reorder-bulk, and are logged, as the genuine changes they are.
    const draftRanks = new Map(reorder.draft.map((r) => [r.id, r.rank]));
    const changes = rankChanges(roles ?? [], reorder.draft).filter((c) => !isTempRoleId(c.role_id));

    // Temp id -> real id, filled as each create resolves rather than from the
    // batch's result, so a partial failure still knows exactly which landed.
    const landed = new Map<number, number>();
    const creates = temps.map((t) => rolesApi.create(tournamentId, {
      label: t.label.trim(),
      permissions: t.permissions as Permission[],
      rank: draftRanks.get(t.id) ?? t.rank,
    }).then((role) => { landed.set(t.id, role.id); return role; }));

    try {
      // Creates are awaited *before* the reorder rather than racing it in one
      // Promise.all: reorder-bulk logs a before/after snapshot of the whole
      // role list, so if it lands first that snapshot is taken in a world
      // where the new role doesn't exist yet — every other role shifts down by
      // one step, which reads as "nothing moved relative to anything" and
      // renders as an audit entry showing no change at all. Creating first
      // means the snapshot contains the new role and the entry shows what it
      // displaced.
      await Promise.all(creates);
      await Promise.all([
        // Skipped entirely when nothing else moved — otherwise a new role
        // slotted into an existing gap would log a pointless reorder.
        changes.length > 0 ? rolesApi.reorderBulk(tournamentId, changes) : Promise.resolve(),
        ...edits.map((r) => rolesApi.update(tournamentId, r.id, {
          label: drafts[r.id].label.trim(),
          permissions: drafts[r.id].permissions,
        })),
      ]);
      setDrafts({});
      saved = true;
    } catch (err: unknown) {
      setFieldError(err instanceof ApiError ? err.message : "Failed to save role.");
    } finally {
      // Promise.all rejects on the first failure, so wait for the rest before
      // reconciling — otherwise a still-in-flight create lands after the
      // refetch and its temp role sticks around as a phantom duplicate.
      await Promise.allSettled(creates);
      // Refetch either way: a partial failure drops what did land and keeps
      // what didn't. Only a clean save may discard the reorder draft — after a
      // failure it's still the user's unsaved work and has to survive.
      if (saved) reorder.resetOnNextRoles();
      await refreshRoles(new Set(landed.keys()));
      // Swap the open role's temp id for the id the backend just assigned, so
      // no negative id survives into the next render or request.
      setActiveRoleId((cur) => (cur !== null ? landed.get(cur) ?? cur : cur));
      setFieldSaving(false);
    }
  }

  function handleCancelAll() {
    setDrafts({});
    setFieldError(undefined);
    if (tempRoles.length === 0) {
      reorder.cancel();
      return;
    }
    // Dropping temp roles changes `roles`, which the reorder hook would
    // normally merge into its draft — tell it to reset instead, so a drag that
    // only moved things to make room for the discarded role is undone too.
    reorder.resetOnNextRoles();
    setRoles((cur) => (cur ?? []).filter((r) => !isTempRole(r)));
    setActiveRoleId((cur) => (cur !== null && isTempRoleId(cur) ? null : cur));
  }

  // Switching roles inside the editor is free (local state); leaving the
  // editor entirely while dirty prompts. FloatingSaveBar registers the guard
  // itself (passed editorPath as stayWithin below).
  const { guard } = useUnsavedChanges();

  // Skips a separate "new role" form: adds an unsaved role to the list and
  // selects it, same as every other role. Nothing is POSTed until Save, so a
  // role produces exactly one audit entry with its final field values. Rank and
  // label are computed from the current list so clicking this repeatedly
  // without editing the previous role never collides (same rank would tie them,
  // same label 409s on save).
  const createDraftRole = useCallback(() => {
    const id = nextTempIdRef.current--;
    setRoles((cur) => {
      const list = cur ?? [];
      return [...list, {
        id,
        tournament_id: tournamentId,
        label: defaultNewRoleLabel(list.map((r) => r.label)),
        permissions: [],
        rank: nextBottomRank(list),
        member_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }];
    });
    setActiveRoleId(id);
    setActiveTab("details");
  }, [tournamentId]);

  // ?role=new — deferred to here rather than the activeRoleId initializer since
  // the default label and rank need the loaded list.
  useEffect(() => {
    if (roles === null || membershipLoading || !pendingNewRoleRef.current) return;
    pendingNewRoleRef.current = false;
    if (canCreateRoles) createDraftRole();
  }, [roles, membershipLoading, canCreateRoles, createDraftRole]);

  if (membershipLoading || roles === null || !canManageRoles) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const activeRole = roles.find((r) => r.id === activeRoleId) ?? null;
  // An unsaved role has no backend row, so there's nothing for the members tab
  // to read or assign against — only Details is meaningful until it's saved.
  const activeIsTemp = activeRole !== null && isTempRole(activeRole);
  const tabs: ("details" | "members")[] = activeIsTemp ? ["details"] : ["details", "members"];

  return (
    <div>
      <PageHeader heading="Roles" subheading="Tournament Settings" />

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        <Card radius="lg" style={{ width: "260px", flexShrink: 0, padding: "8px" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 4px 8px", marginBottom: "4px", borderBottom: "1px solid var(--color-border)",
          }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => guard(() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles`))}
              style={{
                padding: "4px 6px",
                fontSize: "11px", fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)",
              }}
            >
              <IconArrowLeft size={12} /> Back
            </Button>

            {canCreateRoles && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                iconOnly
                onClick={createDraftRole}
                title="New role"
                style={{ width: "22px", height: "22px" }}
              >
                <IconPlus size={12} />
              </Button>
            )}
          </div>

          <DndContext {...reorder.dndProps}>
            <RoleDropDivider state={reorder.dividerStateFor(null, reorder.groups[0]?.[0] ?? null)} />
            {reorder.groups.map((group, gi) => (
              <Fragment key={group[0].id}>
                <div style={{
                  display: "flex", flexDirection: "column",
                  padding: "4px",
                  border: group.length > 1 ? "1px dashed var(--color-border-strong)" : "1px solid transparent",
                  borderRadius: "var(--radius-md)",
                }}>
                  {group.map((role, ri) => (
                    <Fragment key={role.id}>
                      <RoleNavRow
                        role={role}
                        displayLabel={drafts[role.id]?.label.trim() || role.label}
                        active={role.id === activeRoleId}
                        lockReason={lockReason(role)}
                        dropIndicator={reorder.dropIndicatorFor(role)}
                        onSelect={setActiveRoleId}
                      />
                      {ri < group.length - 1 && (
                        <RoleDropDivider state={reorder.dividerStateFor(role, group[ri + 1])} />
                      )}
                    </Fragment>
                  ))}
                </div>
                <RoleDropDivider state={reorder.dividerStateFor(group[group.length - 1], reorder.groups[gi + 1]?.[0] ?? null)} />
              </Fragment>
            ))}
          </DndContext>
        </Card>

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeRole ? (
            <>
              <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--color-border)", marginBottom: "16px" }}>
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "10px 4px", marginRight: "20px", border: "none", background: "transparent", cursor: "pointer",
                      borderBottom: activeTab === tab ? "2px solid var(--color-accent)" : "2px solid transparent",
                      fontFamily: "var(--font-sans)", fontSize: "13px",
                      fontWeight: activeTab === tab ? 600 : 500,
                      color: activeTab === tab ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                    }}
                  >
                    {tab === "details" ? "Details" : `Members — ${memberCounts[activeRole.id] ?? 0}`}
                  </button>
                ))}
              </div>

              {activeTab === "details" || activeIsTemp ? (
                <RoleEditorForm
                  tournamentId={tournamentId}
                  role={activeRole}
                  draft={draftFor(activeRole)}
                  setDraft={setDraft}
                  locked={lockReason(activeRole) !== null}
                  memberCount={memberCounts[activeRole.id] ?? 0}
                  onDeleted={async () => {
                    await refreshRoles();
                    setActiveRoleId(null);
                  }}
                  // Never persisted, so discarding is just dropping it locally.
                  onDiscard={activeIsTemp ? () => {
                    const id = activeRole.id;
                    setRoles((cur) => (cur ?? []).filter((r) => r.id !== id));
                    setActiveRoleId(null);
                  } : undefined}
                />
              ) : (
                <RoleMembersTab
                  tournamentId={tournamentId}
                  role={activeRole}
                  locked={lockReason(activeRole) !== null}
                  onChanged={() => refreshRoles()}
                />
              )}
            </>
          ) : (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "12px" }}>
              Select a role from the list to edit it.
            </p>
          )}
        </div>
      </div>

      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={error}
        onSave={handleSaveAll}
        onCancel={handleCancelAll}
        stayWithin={editorPath}
      />
    </div>
  );
}

interface RoleNavRowProps {
  role:          Role;
  displayLabel:  string;
  active:        boolean;
  lockReason:    string | null;
  dropIndicator: { noop: boolean } | null;
  onSelect:      (roleId: number) => void;
}

// Memoized: the page re-renders on every draft keystroke now that drafts
// live here, and only the edited role's row actually changes.
const RoleNavRow = memo(function RoleNavRow({ role, displayLabel, active, lockReason, dropIndicator, onSelect }: RoleNavRowProps) {
  const locked = lockReason !== null;
  const { setGripRef, gripProps, setDropRef, dragStyle } = useRoleRowDrag(role.id, locked);

  const indicatorStyle: React.CSSProperties = dropIndicator
    ? { background: dropIndicator.noop ? "var(--color-accent-subtle)" : "var(--color-success-subtle)" }
    : {};

  // No separate grip handle — the whole row is the drag handle, so both
  // useDraggable's and useDroppable's refs/props land on this one button.
  return (
    <button
      ref={(node) => { setGripRef(node); setDropRef(node); }}
      {...(locked ? {} : gripProps)}
      type="button"
      onClick={() => onSelect(role.id)}
      style={{
        ...dragStyle,
        display: "flex", alignItems: "center", gap: "8px", width: "100%",
        padding: "7px 8px", border: "none", cursor: "pointer",
        borderRadius: "var(--radius-md)",
        background: active ? "var(--color-accent-subtle)" : "transparent",
        ...indicatorStyle,
      }}
    >
      <span style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "20px", height: "20px", borderRadius: "50%",
        background: "var(--color-accent-subtle)", color: "var(--color-text-secondary)",
        flexShrink: 0,
      }}>
        <IconUserShield size={10} />
      </span>

      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: active ? 600 : 500,
        color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left",
      }}>
        {displayLabel}
      </span>

      {locked && (
        <Tooltip variant="info" message={lockReason} showIcon={false}>
          <span style={{ display: "flex", color: "var(--color-text-tertiary)" }}>
            <IconLock size={12} />
          </span>
        </Tooltip>
      )}
    </button>
  );
});
