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
import { Tooltip } from "@/components/ui/Tooltip";
import { DeleteRoleModal } from "@/components/tournament/settings/DeleteRoleModal";
import {
  IconPlus, IconSearch, IconLock, IconEye, IconEdit, IconTrash, IconGripVertical, IconUser, IconUserShield,
} from "@/components/ui/Icons";

// Shared between the header row and each RoleRow so the label/members/actions
// columns line up: role label, member count, edit+delete buttons.
const ROLE_ROW_COLUMNS = "1fr 90px 92px";

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

  // Returns why a role can't be edited, or null if it's editable.
  function lockReason(role: Role): string | null {
    if (!canManageRoles) return "You don't have permission to manage roles.";
    if (isAdmin || isOwner) return null;
    if (ownRank === null) return "You don't hold any role here, so you can't manage roles.";
    if (role.rank <= ownRank) return "This role is at or above your own rank — you can't edit roles that outrank or tie your highest role.";
    return null;
  }

  function isLocked(role: Role): boolean {
    return lockReason(role) !== null;
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
            icon={<IconUserShield size={28} />}
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
            Roles grouped inside a dashed border share the same rank — they&rsquo;re peers and can&rsquo;t edit each other.
          </p>

          {loadError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
              {loadError}
            </p>
          )}

          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <div style={{
              display: "grid", gridTemplateColumns: ROLE_ROW_COLUMNS,
              padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}>
              <span>Roles — {roles.length}</span>
              <span style={{ textAlign: "center" }}>Members</span>
              <span />
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredRoles.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {groupByRank(filteredRoles).map((group) => (
                  <div
                    key={group[0].id}
                    style={{
                      display:      "flex",
                      flexDirection: "column",
                      gap:          "2px",
                      marginBottom: "6px",
                      padding:      "4px",
                      border:       group.length > 1 ? "1px dashed var(--color-border-strong)" : "1px solid transparent",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    {group.map((role) => (
                      <RoleRow
                        key={role.id}
                        role={role}
                        lockReason={lockReason(role)}
                        memberCount={memberCounts[role.id] ?? 0}
                        onView={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`)}
                        onEdit={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`)}
                        onDelete={() => setDeleteTarget(role)}
                      />
                    ))}
                  </div>
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

// Consecutive roles sharing a rank are peers — neither can edit the other
// (see validate_rank_bound's `rank <= actor_rank`) — so they're rendered as
// one visually clustered group instead of a flat list.
function groupByRank(roles: Role[]): Role[][] {
  const groups: Role[][] = [];
  for (const role of roles) {
    const last = groups[groups.length - 1];
    if (last && last[0].rank === role.rank) last.push(role);
    else groups.push([role]);
  }
  return groups;
}

interface RoleRowProps {
  role:         Role;
  lockReason:   string | null;
  memberCount:  number;
  onView:       () => void;
  onEdit:       () => void;
  onDelete:     () => void;
}

function RoleRow({ role, lockReason, memberCount, onView, onEdit, onDelete }: RoleRowProps) {
  const locked = lockReason !== null;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: role.id,
    disabled: locked,
  });
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    // Negative margin + matching padding pulls the box's left edge out into
    // the gutter where the grip floats, so that space is part of this
    // element's own hit-test box — hovering toward the grip no longer
    // crosses a "dead zone" that would fire onMouseLeave before it arrives.
    <div
      style={{ position: "relative", marginLeft: "-31px", paddingLeft: "31px", boxSizing: "border-box" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!locked && (
        <span
          {...attributes}
          {...listeners}
          style={{
            position: "absolute", left: "0", top: "50%", transform: "translateY(-50%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "25px", height: "25px",
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
            background: "var(--color-surface)", color: "var(--color-text-tertiary)",
            cursor: "grab",
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 120ms ease",
          }}
        >
          <IconGripVertical size={16} />
        </span>
      )}

      <div
        ref={setNodeRef}
        style={{
          ...style,
          display: "grid", gridTemplateColumns: ROLE_ROW_COLUMNS, alignItems: "center",
          padding: "10px 8px",
          borderRadius: "var(--radius-md)",
          borderTop: isOver && !locked ? "2px solid var(--color-success)" : "2px solid transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "24px", height: "24px", borderRadius: "50%",
            background: "var(--color-accent-subtle)", color: "var(--color-text-secondary)",
            flexShrink: 0,
          }}>
            <IconUserShield size={12} />
          </span>

          {locked && (
            <Tooltip variant="info" message={lockReason} showIcon={false}>
              <span style={{ display: "flex", color: "var(--color-text-tertiary)" }}>
                <IconLock size={13} />
              </span>
            </Tooltip>
          )}

          <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}>
            {role.label}
          </span>
        </div>

        <span style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)",
        }}>
          {memberCount} <IconUser size={12} />
        </span>

        <div style={{ display: "flex", gap: "6px", justifySelf: "end" }}>
          <Button type="button" variant="secondary" size="sm" onClick={locked ? onView : onEdit} style={{ padding: "0 10px" }}>
            {locked ? <IconEye size={13} /> : <IconEdit size={13} />}
          </Button>
          <Button
            type="button" variant="secondary" size="sm" disabled={locked} onClick={onDelete}
            style={{ padding: "0 10px", color: "var(--color-danger)" }}
          >
            <IconTrash size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}
