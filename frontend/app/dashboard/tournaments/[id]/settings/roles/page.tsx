"use client";

import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DndContext } from "@dnd-kit/core";
import { rolesApi, Role, RoleWithMemberCount, ApiError } from "@/lib/api";
import { groupByRank } from "@/lib/roles/roleReorder";
import { useRoleReorder, useRoleRowDrag } from "@/lib/roles/useRoleReorder";
import { useRoleLock } from "@/lib/roles/useRoleLock";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { DeleteRoleModal } from "@/components/tournament/settings/DeleteRoleModal";
import { RoleDropDivider } from "@/components/tournament/settings/RoleDropDivider";
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
  const { canManageRoles, canCreateRoles, membershipLoading, lockReason, isLocked } = useRoleLock();

  const [roles, setRoles] = useState<RoleWithMemberCount[] | null>(null);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

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
  }, [tournamentId]);

  // Sourced from the roles list itself (member_count is computed server-side)
  // rather than a separate memberships fetch — one GET instead of two.
  const memberCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const r of roles ?? []) counts[r.id] = r.member_count;
    return counts;
  }, [roles]);

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

  // Nothing is POSTed here. The editor owns role creation end to end so the
  // new role only hits the backend once, with its final label/permissions/rank
  // — otherwise every new role logged a throwaway create plus an update.
  function handleCreateRole() {
    router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/edit?role=new`);
  }

  // Dragging only mutates this hook's local draft — nothing hits the network
  // until Save, so no GET round-trip can flash a stale order mid-reorder.
  // The hook's onSaved is typed generically as Role[], but it only ever
  // spreads the RoleWithMemberCount objects we passed in, so member_count
  // survives at runtime — the cast just corrects the narrowed type.
  const reorder = useRoleReorder({
    tournamentId, roles, isLocked,
    onSaved: (updated) => setRoles(updated as RoleWithMemberCount[]),
  });

  const filteredRoles = reorder.draft.filter((r) => r.label.toLowerCase().includes(search.toLowerCase()));

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

  const groups = groupByRank(filteredRoles);

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
                  <Button type="button" variant="secondary" size="sm" onClick={handleCreateRole}>
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
            <div style={{ flex: 1 }}>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles"
                icon={<IconSearch size={14} />}
                font="sans"
                variant="secondary"
                size="md"
                fullWidth
              />
            </div>
            {canCreateRoles && (
              <Button
                type="button" variant="primary" size="md"
                onClick={handleCreateRole}
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

            <DndContext {...reorder.dndProps}>
              <RoleDropDivider state={reorder.dividerStateFor(null, groups[0]?.[0] ?? null)} />
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
                          dropIndicator={reorder.dropIndicatorFor(role)}
                          onDelete={setDeleteTarget}
                        />
                        {ri < group.length - 1 && (
                          <RoleDropDivider state={reorder.dividerStateFor(role, group[ri + 1])} />
                        )}
                      </Fragment>
                    ))}
                  </div>
                  <RoleDropDivider state={reorder.dividerStateFor(group[group.length - 1], groups[gi + 1]?.[0] ?? null)} />
                </Fragment>
              ))}
            </DndContext>
          </Card>
        </>
      )}

      <FloatingSaveBar
        visible={reorder.isDirty}
        saving={reorder.saving}
        error={reorder.error}
        onSave={reorder.save}
        onCancel={reorder.cancel}
      />

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
  role:          Role;
  tournamentId:  number;
  lockReason:    string | null;
  memberCount:   number;
  // Only ever set for a "join this tie group" hover — above/below insertion
  // points are shown by the dividers between rows instead.
  dropIndicator: { noop: boolean } | null;
  onDelete:      (role: Role) => void;
}

const RoleRow = memo(function RoleRow({ role, tournamentId, lockReason, memberCount, dropIndicator, onDelete }: RoleRowProps) {
  const router = useRouter();
  const locked = lockReason !== null;
  const { setGripRef, gripProps, setDropRef, dragStyle } = useRoleRowDrag(role.id, locked);
  const [hovered, setHovered] = useState(false);

  const indicatorStyle: React.CSSProperties = dropIndicator
    ? { background: dropIndicator.noop ? "var(--color-accent-subtle)" : "var(--color-success-subtle)" }
    : {};

  function goToRole() {
    router.push(`/dashboard/tournaments/${tournamentId}/settings/roles/edit?role=${role.id}`);
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
          ref={setGripRef}
          {...gripProps}
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
          <Button type="button" variant="secondary" size="sm" iconOnly onClick={goToRole}>
            {locked ? <IconEye size={13} /> : <IconEdit size={13} />}
          </Button>
          <Button
            type="button" variant="secondary" size="sm" iconOnly disabled={locked} onClick={() => onDelete(role)}
            style={{ color: "var(--color-danger)" }}
          >
            <IconTrash size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
});
