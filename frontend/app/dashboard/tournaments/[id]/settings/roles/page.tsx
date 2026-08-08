"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { rolesApi, membershipsApi, Role, MembershipSlim, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteRoleModal } from "@/components/tournament/settings/DeleteRoleModal";
import {
  IconPlus, IconSearch, IconLock, IconEye, IconEdit, IconTrash, IconGripVertical, IconUser, IconShield,
} from "@/components/ui/Icons";

export default function RolesSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [memberCounts, setMemberCounts] = useState<Record<number, number>>({});
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageRoles = isAdmin || isOwner || hasPermission("manage_roles");

  const ownRank = useMemo(() => {
    if (!membership || membership.roles.length === 0) return null;
    return Math.min(...membership.roles.map((r) => r.rank));
  }, [membership]);

  function isLocked(role: Role): boolean {
    if (!canManageRoles) return true;
    if (isAdmin || isOwner) return false;
    if (ownRank === null) return true;
    return role.rank <= ownRank;
  }

  function loadRoles() {
    rolesApi.list(tournamentId).then(setRoles).catch(() => setLoadError("Failed to load roles."));
  }

  useEffect(() => {
    loadRoles();
    membershipsApi.list(tournamentId).then((members: MembershipSlim[]) => {
      const counts: Record<number, number> = {};
      for (const m of members) {
        for (const r of m.roles) counts[r.id] = (counts[r.id] ?? 0) + 1;
      }
      setMemberCounts(counts);
    }).catch(() => {});
  }, [tournamentId]);

  async function handleApplyTemplate() {
    setApplying(true);
    setLoadError(undefined);
    try {
      const created = await rolesApi.applyTemplate(tournamentId);
      setRoles(created);
    } catch (err: unknown) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to apply default roles.");
    } finally {
      setApplying(false);
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!roles || !over || active.id === over.id) return;

    const overRole = roles.find((r) => r.id === over.id);
    if (!overRole || isLocked(overRole)) return;

    const oldIndex = roles.findIndex((r) => r.id === active.id);
    const newIndex = roles.findIndex((r) => r.id === over.id);
    const draggedRole = roles[oldIndex];
    if (isLocked(draggedRole)) return;

    const reordered = arrayMove(roles, oldIndex, newIndex);
    setRoles(reordered);

    const pos = reordered.findIndex((r) => r.id === draggedRole.id);
    const rankAbove = reordered[pos - 1]?.rank;
    const rankBelow = reordered[pos + 1]?.rank;

    try {
      if (rankAbove === undefined && rankBelow !== undefined) {
        await rolesApi.reorder(tournamentId, draggedRole.id, { drop_type: "new_rank_at_top", rank_below: rankBelow });
      } else if (rankBelow === undefined && rankAbove !== undefined) {
        await rolesApi.reorder(tournamentId, draggedRole.id, { drop_type: "new_rank_at_bottom", rank_above: rankAbove });
      } else if (rankAbove !== undefined && rankBelow !== undefined) {
        await rolesApi.reorder(tournamentId, draggedRole.id, { drop_type: "new_rank_between", rank_above: rankAbove, rank_below: rankBelow });
      }
    } finally {
      // A rebalance may have shifted other ranks — always resync from the server.
      loadRoles();
    }
  }

  const filteredRoles = (roles ?? []).filter((r) => r.label.toLowerCase().includes(search.toLowerCase()));

  if (membershipLoading || roles === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Roles" subheading="Tournament Settings" />

      {roles.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconShield size={28} />}
            title="No roles yet"
            description="Start from the default template, or create roles from scratch."
            action={
              canManageRoles ? (
                <div style={{ display: "flex", gap: "10px" }}>
                  <Button type="button" variant="primary" size="sm" loading={applying} onClick={handleApplyTemplate}>
                    Apply default template
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/new`)}>
                    Create role
                  </Button>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }}>
                <IconSearch size={14} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles"
                style={{
                  width: "100%", height: "36px", paddingLeft: "34px", paddingRight: "12px",
                  fontFamily: "var(--font-sans)", fontSize: "13px",
                  background: "var(--color-surface)", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)", outline: "none",
                }}
              />
            </div>
            {canManageRoles && (
              <Button
                type="button" variant="primary" size="md"
                onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/new`)}
              >
                <IconPlus size={14} /> Create Role
              </Button>
            )}
          </div>

          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginBottom: "16px" }}>
            Members use the permissions of every role they hold. Drag roles to reorder their authority.
          </p>

          {loadError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
              {loadError}
            </p>
          )}

          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              padding: "12px 8px", fontFamily: "var(--font-sans)", fontSize: "11px",
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}>
              <span>Roles — {roles.length}</span>
              <span>Members</span>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredRoles.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {filteredRoles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    locked={isLocked(role)}
                    memberCount={memberCounts[role.id] ?? 0}
                    onView={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`)}
                    onEdit={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`)}
                    onDelete={() => setDeleteTarget(role)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </Card>
        </>
      )}

      {deleteTarget && (
        <DeleteRoleModal
          tournamentId={tournamentId}
          roleId={deleteTarget.id}
          roleLabel={deleteTarget.label}
          membersAffected={memberCounts[deleteTarget.id] ?? 0}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); loadRoles(); }}
        />
      )}
    </div>
  );
}

interface RoleRowProps {
  role:         Role;
  locked:       boolean;
  memberCount:  number;
  onView:       () => void;
  onEdit:       () => void;
  onDelete:     () => void;
}

function RoleRow({ role, locked, memberCount, onView, onEdit, onDelete }: RoleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: role.id,
    disabled: locked,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 8px",
        borderRadius: "var(--radius-md)",
        borderTop: isOver && !locked ? "2px solid var(--color-success)" : "2px solid transparent",
        cursor: locked ? "not-allowed" : undefined,
      }}
    >
      <span
        {...(locked ? {} : attributes)}
        {...(locked ? {} : listeners)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "18px", color: "var(--color-text-tertiary)",
          cursor: locked ? "not-allowed" : "grab",
        }}
      >
        {locked ? <IconLock size={13} /> : <IconGripVertical size={14} />}
      </span>

      <span style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "24px", height: "24px", borderRadius: "50%",
        background: "var(--color-accent-subtle)", color: "var(--color-text-secondary)",
        flexShrink: 0,
      }}>
        <IconShield size={12} />
      </span>

      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, flex: 1 }}>
        {role.label}
      </span>

      <span style={{
        display: "flex", alignItems: "center", gap: "6px",
        fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)",
        width: "60px", justifyContent: "flex-end",
      }}>
        {memberCount} <IconUser size={12} />
      </span>

      <div style={{ display: "flex", gap: "6px" }}>
        <Button type="button" variant="secondary" size="sm" onClick={locked ? onView : onEdit} style={{ padding: "0 10px" }}>
          {locked ? <IconEye size={13} /> : <IconEdit size={13} />}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={locked} onClick={onDelete} style={{ padding: "0 10px" }}>
          <IconTrash size={13} />
        </Button>
      </div>
    </div>
  );
}
