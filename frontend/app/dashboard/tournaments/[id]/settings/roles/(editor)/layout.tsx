"use client";

import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DndContext } from "@dnd-kit/core";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { rolesApi, ApiError, Role } from "@/lib/api";
import { useRoleReorder, useRoleRowDrag } from "@/lib/useRoleReorder";
import { defaultNewRoleLabel, nextBottomRank } from "@/lib/roleReorder";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { RoleDropDivider } from "@/components/tournament/settings/RoleDropDivider";
import { IconArrowLeft, IconLock, IconPlus, IconUserShield } from "@/components/ui/Icons";
import { RoleFieldSave, RoleFieldSaveProvider, RoleListProvider } from "./RoleFieldSaveContext";

export default function RoleEditorLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const activeRoleId = Number(params.roleId);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageRoles = isAdmin || isOwner || hasPermission("manage_roles");

  const ownRank = useMemo(() => {
    if (!membership || membership.roles.length === 0) return null;
    return Math.min(...membership.roles.map((r) => r.rank));
  }, [membership]);

  const lockReason = useCallback((role: Role): string | null => {
    if (!canManageRoles) return "You don't have permission to manage roles.";
    if (isAdmin || isOwner) return null;
    if (ownRank === null) return "You don't hold any role here, so you can't manage roles.";
    if (role.rank <= ownRank) return "This role is at or above your own rank — you can't edit roles that outrank or tie your highest role.";
    return null;
  }, [canManageRoles, isAdmin, isOwner, ownRank]);

  const isLocked = useCallback((role: Role) => lockReason(role) !== null, [lockReason]);

  const refreshRoles = useCallback(async () => {
    const next = await rolesApi.list(tournamentId).catch(() => []);
    setRoles(next);
  }, [tournamentId]);

  useEffect(() => { refreshRoles(); }, [refreshRoles]);

  // The index page already shows a locked "No access" state for this — send
  // anyone without manage_roles back there instead of letting them sit here.
  useEffect(() => {
    if (!membershipLoading && !canManageRoles) {
      router.replace(`/dashboard/tournaments/${tournamentId}/settings/roles`);
    }
  }, [membershipLoading, canManageRoles, router, tournamentId]);

  const reorder = useRoleReorder({ tournamentId, roles, isLocked, onSaved: setRoles });

  // The active page (only the [roleId] editor, not /new) registers its own
  // label/permissions draft here so both it and the nav reorder above share
  // one save bar instead of popping up two.
  const [fieldSave, setFieldSave] = useState<RoleFieldSave | null>(null);

  const isDirty = reorder.isDirty || !!fieldSave?.isDirty;
  const saving = reorder.saving || !!fieldSave?.saving;
  const error = reorder.error ?? fieldSave?.error;

  async function handleSaveAll() {
    await Promise.all([
      reorder.isDirty ? reorder.save() : Promise.resolve(),
      fieldSave?.isDirty ? fieldSave.save() : Promise.resolve(),
    ]);
  }

  function handleCancelAll() {
    reorder.cancel();
    fieldSave?.cancel();
  }

  // Skips a separate "new role" form — creates a placeholder immediately and
  // drops the user straight into editing it (including reordering it right
  // there in the nav), same as every other role. Rank and label are computed
  // from the current list so clicking this repeatedly without editing the
  // previous role never collides (same rank would tie them, same label 409s).
  async function handleCreateRole() {
    setCreatingRole(true);
    setCreateError(undefined);
    try {
      const role = await rolesApi.create(tournamentId, {
        label: defaultNewRoleLabel(roles?.map((r) => r.label) ?? []),
        permissions: [],
        rank: nextBottomRank(roles ?? []),
      });
      await refreshRoles();
      router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`);
    } catch (err: unknown) {
      setCreateError(err instanceof ApiError ? err.message : "Failed to create role.");
    } finally {
      setCreatingRole(false);
    }
  }

  if (membershipLoading || roles === null || !canManageRoles) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

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
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles`)}
              style={{
                padding: "4px 6px",
                fontSize: "11px", fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)",
              }}
            >
              <IconArrowLeft size={12} /> Back
            </Button>

            {canManageRoles && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={creatingRole}
                onClick={handleCreateRole}
                title="New role"
                style={{ width: "22px", height: "22px", padding: 0, gap: 0 }}
              >
                {/* Button always renders its own spinner when loading — hide
                    the icon instead of showing both in a 22px square. */}
                {!creatingRole && <IconPlus size={12} />}
              </Button>
            )}
          </div>

          {createError && (
            <p style={{
              fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)",
              padding: "0 4px 8px",
            }}>
              {createError}
            </p>
          )}

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
                        active={role.id === activeRoleId}
                        lockReason={lockReason(role)}
                        dropIndicator={reorder.dropIndicatorFor(role)}
                        onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`)}
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
          <RoleListProvider value={{ roles, refreshRoles, lockReason }}>
            <RoleFieldSaveProvider value={setFieldSave}>
              {children}
            </RoleFieldSaveProvider>
          </RoleListProvider>
        </div>
      </div>

      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={error}
        onSave={handleSaveAll}
        onCancel={handleCancelAll}
      />
    </div>
  );
}

interface RoleNavRowProps {
  role:          Role;
  active:        boolean;
  lockReason:    string | null;
  dropIndicator: { noop: boolean } | null;
  onClick:       () => void;
}

function RoleNavRow({ role, active, lockReason, dropIndicator, onClick }: RoleNavRowProps) {
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
      onClick={onClick}
      style={{
        ...dragStyle,
        display: "flex", alignItems: "center", gap: "8px", width: "100%",
        padding: "7px 8px", border: "none", cursor: locked ? "pointer" : "grab",
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
        {role.label}
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
}
