"use client";

import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  DndContext, DragEndEvent, DragMoveEvent, PointerSensor,
  closestCenter, useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { rolesApi, membershipsApi, Role, MembershipSlim, RoleReorderPayload, ApiError } from "@/lib/api";
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

  // Bumped per request so a slow earlier resync can't clobber a newer one.
  const loadSeq = useRef(0);

  async function loadRoles() {
    const seq = ++loadSeq.current;
    try {
      const next = await rolesApi.list(tournamentId);
      if (seq === loadSeq.current) setRoles(next);
    } catch {
      setLoadError("Failed to load roles.");
    }
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

  // Which row is currently a drop target, and what dropping now would do —
  // computed live in onDragOver so the row can render the right indicator
  // (join/above/below, or a muted "no-op") before the drop actually happens.
  const [dropZone, setDropZone] = useState<{ id: number; zone: DropZoneKind; noop: boolean } | null>(null);

  // Wired to onDragMove as well as onDragOver: dnd-kit only fires onDragOver
  // when over.id *changes*, which sampled the zone once per row crossing —
  // so "above" on the first row and "below" on the last row (and "join"
  // anywhere) were unreachable, since nothing is ever crossed into there.
  function handleDragOver(event: DragMoveEvent) {
    const { active, over } = event;
    if (!roles || !over || active.id === over.id) { setDropZone(null); return; }

    const draggedRole = roles.find((r) => r.id === active.id);
    const targetRole = roles.find((r) => r.id === over.id);
    if (!draggedRole || !targetRole || isLocked(draggedRole) || isLocked(targetRole)) { setDropZone(null); return; }

    const activeRect = active.rect.current.translated;
    if (!activeRect) { setDropZone(null); return; }

    const activeCenterY = activeRect.top + activeRect.height / 2;
    const relative = (activeCenterY - over.rect.top) / over.rect.height;
    const zone: DropZoneKind = relative < 0.3 ? "above" : relative > 0.7 ? "below" : "join";

    const action = computeReorderAction(roles, draggedRole, targetRole, zone);
    // Now runs every pointer move — keep the state object identity stable when
    // nothing changed so the memoized rows/dividers don't re-render.
    setDropZone((prev) =>
      prev && prev.id === targetRole.id && prev.zone === zone && prev.noop === action.noop
        ? prev
        : { id: targetRole.id, zone, noop: action.noop },
    );
  }

  // A drop applied against ranks from before the previous drop's resync would
  // compute its neighbors from stale data, so drops are serialized.
  const reordering = useRef(false);

  async function handleDragEnd(event: DragEndEvent) {
    const { active } = event;
    const zone = dropZone;
    setDropZone(null);
    if (!roles || !zone || reordering.current) return;

    const draggedRole = roles.find((r) => r.id === active.id);
    // Target comes from the previewed zone, not the drop event's `over`, so
    // what gets applied is always what the indicator was showing.
    const targetRole = roles.find((r) => r.id === zone.id);
    if (!draggedRole || !targetRole || draggedRole.id === targetRole.id) return;

    const action = computeReorderAction(roles, draggedRole, targetRole, zone.zone);
    if (action.noop) return;

    reordering.current = true;
    try {
      await rolesApi.reorder(tournamentId, draggedRole.id, action.payload);
    } finally {
      // A rebalance may have shifted other ranks — always resync from the server.
      await loadRoles();
      reordering.current = false;
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

  if (!canManageRoles) {
    return (
      <div>
        <PageHeader heading="Roles" subheading="Tournament Settings" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage roles permission to view this page."
          />
        </Card>
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

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragMove={handleDragOver}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDropZone(null)}
            >
              {(() => {
                const groups = groupByRank(filteredRoles);
                // A divider between `prev` and `next` lights up if the current
                // drop zone points at either side of that same boundary —
                // hovering the bottom of `prev` and the top of `next` mean
                // the same insertion point.
                function dividerState(prev: Role | null, next: Role | null): "success" | "noop" | null {
                  if (!dropZone) return null;
                  // Never light the divider between two roles already tied
                  // to each other — that boundary is internal to the group.
                  if (prev && next && prev.rank === next.rank) return null;
                  const matches =
                    (prev && dropZone.id === prev.id && dropZone.zone === "below") ||
                    (next && dropZone.id === next.id && dropZone.zone === "above");
                  if (!matches) return null;
                  return dropZone.noop ? "noop" : "success";
                }

                return (
                  <>
                    <Divider state={dividerState(null, groups[0]?.[0] ?? null)} />
                    {groups.map((group, gi) => (
                      <Fragment key={group[0].id}>
                        <div style={{
                          display: "flex", flexDirection: "column",
                          padding: "4px",
                          border: group.length > 1 ? "1px dashed var(--color-border-strong)" : "1px solid transparent",
                          borderRadius: "var(--radius-md)",
                        }}>
                          {group.map((role, ri) => (
                            <Fragment key={role.id}>
                              <RoleRow
                                role={role}
                                tournamentId={tournamentId}
                                lockReason={lockReason(role)}
                                memberCount={memberCounts[role.id] ?? 0}
                                dropIndicator={
                                  dropZone?.id === role.id && dropZone.zone === "join"
                                    ? { noop: dropZone.noop }
                                    : null
                                }
                                onDelete={setDeleteTarget}
                              />
                              {ri < group.length - 1 && <Divider state={dividerState(role, group[ri + 1])} />}
                            </Fragment>
                          ))}
                        </div>
                        <Divider state={dividerState(group[group.length - 1], groups[gi + 1]?.[0] ?? null)} />
                      </Fragment>
                    ))}
                  </>
                );
              })()}
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

// Always rendered (never removed) so it reserves its space whether active or
// not — the "insert here" indicator this way never shifts surrounding rows,
// unlike a border on the row itself which can flicker between two rows near
// their shared edge.
const Divider = memo(function Divider({ state }: { state: "success" | "noop" | null }) {
  return (
    <div style={{ height: "8px", display: "flex", alignItems: "center", padding: "0 4px" }}>
      <div style={{
        height: "2px", width: "100%", borderRadius: "1px",
        background: state === "success" ? "var(--color-success)" : state === "noop" ? "var(--color-border-strong)" : "transparent",
        transition: "background 100ms ease",
      }} />
    </div>
  );
});

type DropZoneKind = "above" | "below" | "join";

// Decides what dropping `draggedRole` onto `targetRole` at `zone` would do.
// Shared between onDragOver (to preview the indicator) and onDragEnd (to
// actually submit it), so the two never disagree about what a drop means.
function computeReorderAction(
  roles: Role[], draggedRole: Role, targetRole: Role, zone: DropZoneKind,
): { noop: true } | { noop: false; payload: RoleReorderPayload } {
  if (zone === "join") {
    if (targetRole.rank === draggedRole.rank) return { noop: true }; // already peers
    return { noop: false, payload: { drop_type: "join_group", target_group_rank: targetRole.rank } };
  }

  const others = roles.filter((r) => r.id !== draggedRole.id);
  const idx = others.findIndex((r) => r.id === targetRole.id);
  const rankAbove = zone === "above" ? others[idx - 1]?.rank : targetRole.rank;
  const rankBelow = zone === "above" ? targetRole.rank : others[idx + 1]?.rank;

  // No integer room between two roles already tied at the same rank — the
  // only meaningful outcome is joining that tier, or a no-op if the dragged
  // role is already part of it. (Sending new_rank_between here is what used
  // to 500 — its midpoint degenerates when both neighbors are identical.)
  if (rankAbove !== undefined && rankBelow !== undefined && rankAbove === rankBelow) {
    if (draggedRole.rank === rankAbove) return { noop: true };
    return { noop: false, payload: { drop_type: "join_group", target_group_rank: rankAbove } };
  }

  if (rankAbove === undefined && rankBelow !== undefined) {
    return { noop: false, payload: { drop_type: "new_rank_at_top", rank_below: rankBelow } };
  }
  if (rankBelow === undefined && rankAbove !== undefined) {
    return { noop: false, payload: { drop_type: "new_rank_at_bottom", rank_above: rankAbove } };
  }
  if (rankAbove !== undefined && rankBelow !== undefined) {
    return { noop: false, payload: { drop_type: "new_rank_between", rank_above: rankAbove, rank_below: rankBelow } };
  }
  return { noop: true }; // only one role in the list
}

interface RoleRowProps {
  role:          Role;
  tournamentId:  number;
  lockReason:    string | null;
  memberCount:   number;
  // Only ever set for a "join this tie group" hover — above/below insertion
  // points are shown by the Dividers between rows instead.
  dropIndicator: { noop: boolean } | null;
  onDelete:      (role: Role) => void;
}

const RoleRow = memo(function RoleRow({ role, tournamentId, lockReason, memberCount, dropIndicator, onDelete }: RoleRowProps) {
  const router = useRouter();
  const locked = lockReason !== null;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: role.id,
    disabled: locked,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: role.id, disabled: locked });
  const [hovered, setHovered] = useState(false);

  // Only the dragged row itself moves (translates to follow the cursor) —
  // siblings never shift to preview a reorder the way a sortable list would.
  const dragStyle: React.CSSProperties = isDragging
    ? { transform: CSS.Translate.toString(transform), opacity: 0.5, position: "relative", zIndex: 1 }
    : {};

  const indicatorStyle: React.CSSProperties = dropIndicator
    ? { background: dropIndicator.noop ? "var(--color-accent-subtle)" : "var(--color-success-subtle)" }
    : {};

  function goToRole() {
    router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/${role.id}`);
  }

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
          ref={setDragRef}
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
        ref={setDropRef}
        style={{
          ...dragStyle,
          display: "grid", gridTemplateColumns: ROLE_ROW_COLUMNS, alignItems: "center",
          padding: "5px 4px",
          borderRadius: "var(--radius-md)",
          borderTop: "2px solid transparent",
          borderBottom: "2px solid transparent",
          cursor: dropIndicator?.noop ? "not-allowed" : undefined,
          ...indicatorStyle,
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
          <Button type="button" variant="secondary" size="sm" onClick={goToRole} style={{ padding: "0 10px" }}>
            {locked ? <IconEye size={13} /> : <IconEdit size={13} />}
          </Button>
          <Button
            type="button" variant="secondary" size="sm" disabled={locked} onClick={() => onDelete(role)}
            style={{ padding: "0 10px", color: "var(--color-danger)" }}
          >
            <IconTrash size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
});
