"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, rolesApi, MembershipSlim, Role, ApiError } from "@/lib/api";
import { formatPhone } from "@/lib/auth";
import { formatDuration, formatDateTime } from "@/lib/timeFormat";
import { STATUS_VARIANT } from "@/lib/membershipDisplay";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { Tooltip } from "@/components/ui/Tooltip";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Checkbox } from "@/components/ui/Checkbox";
import { RolesCell } from "@/components/tournament/RolesCell";
import { JoinMethodCell } from "@/components/tournament/JoinMethodCell";
import { MemberPanel } from "@/components/tournament/MemberPanel";
import { MassRoleEditor } from "@/components/tournament/MassRoleEditor";
import { RemoveMemberModal } from "@/components/tournament/RemoveMemberModal";
import { SelfRemoveRedirectModal } from "@/components/tournament/SelfRemoveRedirectModal";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { IconLock, IconSearch, IconArrowDown, IconExpand, IconTrash, IconMembers } from "@/components/ui/Icons";

// Name / Email / Phone / Account Age / Join Date / Join Method / Status / Roles / Actions
const MEMBER_ROW_COLUMNS = "0.8fr 1.2fr 0.6fr 90px 90px 110px 90px 2.6fr 70px";
const SELECT_COLUMN = "28px ";

type SortField = "first_name" | "last_name" | "joined" | "account_age";
type SortDir = "asc" | "desc";

const SORT_FIELD_OPTIONS = [
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "joined", label: "Joined" },
  { value: "account_age", label: "Account age" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "interested", label: "Interested" },
  { value: "confirmed", label: "Confirmed" },
];

function memberName(m: MembershipSlim): string {
  return `${m.user.first_name ?? ""} ${m.user.last_name ?? ""}`.trim() || m.user.email;
}

function sortValue(m: MembershipSlim, field: SortField): string | number {
  switch (field) {
    case "first_name": return (m.user.first_name ?? "").toLowerCase();
    case "last_name": return (m.user.last_name ?? "").toLowerCase();
    case "joined": return new Date(m.created_at).getTime();
    case "account_age": return new Date(m.user.created_at).getTime();
  }
}

function DurationCell({ iso }: { iso: string }) {
  return (
    <span style={{ justifySelf: "center" }}>
      <Tooltip variant="info" message={formatDateTime(iso)} showIcon={false}>
        <span
          style={{
            fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
            cursor: "default",
          }}
        >
          {formatDuration(iso)}
        </span>
      </Tooltip>
    </span>
  );
}

function MemberRow({
  tournamentId, membership, allRoles, canTouchRole, locked, isSelf, isArchived, onUpdated, onExpand, onRemove, onSelfRemove, isLast,
  selectMode, selected, onToggleSelect,
}: {
  tournamentId: number;
  membership: MembershipSlim;
  allRoles: Role[];
  canTouchRole: (role: Role) => boolean;
  /** Shared gate for both role editing and removal — mirrors the backend's validate_member_target: archived, target is the tournament owner, or target outranks the actor. */
  locked: boolean;
  /** This row is the current user's own membership — removal always redirects to the General Settings leave flow instead of using this gate. */
  isSelf: boolean;
  /** Archived tournaments hide the remove control entirely rather than showing it disabled. */
  isArchived: boolean;
  onUpdated: (updated: MembershipSlim) => void;
  onExpand: (membershipId: number) => void;
  onRemove: (membership: MembershipSlim) => void;
  onSelfRemove: (membership: MembershipSlim) => void;
  isLast: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { user } = membership;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: selectMode ? SELECT_COLUMN + MEMBER_ROW_COLUMNS : MEMBER_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: selected ? "var(--color-bg)" : hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
        cursor: selectMode ? "pointer" : "default",
      }}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      {selectMode && (
        <span style={{ display: "flex", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onChange={onToggleSelect} />
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <AvatarCircle user={user} size="sm" />
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
        </span>
      </div>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {user.email}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {user.phone ? formatPhone(user.phone) : "—"}
      </span>
      <DurationCell iso={user.created_at} />
      <DurationCell iso={membership.created_at} />
      <JoinMethodCell membership={membership} style={{ justifySelf: "center" }} />
      <Badge variant={STATUS_VARIANT[membership.status] ?? "default"} style={{ justifySelf: "center" }}>
        {membership.status}
      </Badge>
      <RolesCell
        tournamentId={tournamentId}
        membership={membership}
        allRoles={allRoles}
        canTouchRole={canTouchRole}
        locked={locked}
        onUpdated={onUpdated}
      />
      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }}>
        {!isArchived && (
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            title={isSelf ? "Leave tournament" : locked ? "You can't remove this member." : "Remove member"}
            disabled={!isSelf && locked}
            onClick={() => (isSelf ? onSelfRemove(membership) : onRemove(membership))}
          >
            <IconTrash size={13} style={{ color: !isSelf && locked ? undefined : "var(--color-danger)" }} />
          </Button>
        )}
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Expand"
          onClick={() => onExpand(membership.id)}
        >
          <IconExpand size={13} />
        </Button>
      </div>
    </div>
  );
}

export default function MembersPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { selectedTournament } = useTournament();
  const { canManageMembers, isArchived, membershipLoading, canTouchRole, canEditMember } = useMemberRoleLock();

  const [members, setMembers] = useState<MembershipSlim[] | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("joined");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MembershipSlim | null>(null);
  const [selfRemoveTarget, setSelfRemoveTarget] = useState<MembershipSlim | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [massEditOpen, setMassEditOpen] = useState(false);

  function toggleSelectMode() {
    setSelectMode((v) => {
      if (v) setSelectedIds(new Set());
      return !v;
    });
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!canManageMembers) return;
    membershipsApi.list(tournamentId)
      .then(setMembers)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load members."));
    rolesApi.list(tournamentId).then(setAllRoles).catch(() => setAllRoles([]));
  }, [tournamentId, canManageMembers]);

  const visibleMembers = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    const filtered = members.filter((m) => {
      if (q && !memberName(m).toLowerCase().includes(q) && !m.user.email.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && !m.roles.some((r) => String(r.id) === roleFilter)) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [members, search, roleFilter, statusFilter, sortField, sortDir]);

  function handleMemberUpdated(updated: MembershipSlim) {
    setMembers((prev) => prev && prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageMembers) {
    return (
      <div>
        <PageHeader heading="Members" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage members permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (members === null) {
    return (
      <div>
        <PageHeader heading="Members" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const isFiltered = search.trim() !== "" || roleFilter !== "all" || statusFilter !== "all";

  return (
    <div>
      <PageHeader heading="Members" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {members.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconMembers size={28} />}
            title="No members yet"
            description="Members who join this tournament will show up here."
          />
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div style={{ width: "350px" }}>
              <Input
                label="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email"
                icon={<IconSearch size={14} />}
                font="sans"
                size="md"
                variant="secondary"
                fullWidth
              />
            </div>
            <Dropdown
              label="Role"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[{ value: "all", label: "All roles" }, ...allRoles.map((r) => ({ value: String(r.id), label: r.label }))]}
              size="md"
              variant="secondary"
              width={170}
            />
            <Dropdown
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTER_OPTIONS}
              size="md"
              variant="secondary"
              width={150}
            />
            <Dropdown
              label="Sort by"
              value={sortField}
              onChange={(v) => setSortField(v as SortField)}
              options={SORT_FIELD_OPTIONS}
              size="md"
              variant="secondary"
              width={150}
            />
            <Button
              type="button" variant="secondary" size="md" iconOnly
              title={sortDir === "asc" ? "Ascending" : "Descending"}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              <IconArrowDown size={18} style={{ transition: "transform 150ms ease", transform: sortDir === "asc" ? "rotate(180deg)" : "rotate(0deg)" }} />
            </Button>
            {canManageMembers && !isArchived && (
              <Button type="button" variant={selectMode ? "primary" : "secondary"} size="md" onClick={toggleSelectMode}>
                Select
              </Button>
            )}
          </div>

          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <div style={{
              display: "grid", gridTemplateColumns: selectMode ? SELECT_COLUMN + MEMBER_ROW_COLUMNS : MEMBER_ROW_COLUMNS, gap: "10px",
              padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}>
              {selectMode && (
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Checkbox
                    checked={visibleMembers.length > 0 && visibleMembers.every((m) => selectedIds.has(m.id))}
                    onChange={(checked) => setSelectedIds((prev) => {
                      const next = new Set(prev);
                      visibleMembers.forEach((m) => (checked ? next.add(m.id) : next.delete(m.id)));
                      return next;
                    })}
                  />
                </span>
              )}
              <span>Members — {isFiltered ? `${visibleMembers.length} of ${members.length}` : members.length}</span>
              <span>Email</span>
              <span>Phone</span>
              <span style={{ textAlign: "center" }}>Account Age</span>
              <span style={{ textAlign: "center" }}>Joined</span>
              <span style={{ textAlign: "center" }}>Method</span>
              <span style={{ textAlign: "center" }}>Status</span>
              <span>Roles</span>
              <span style={{ textAlign: "center" }}>Actions</span>
            </div>

            {visibleMembers.length === 0 ? (
              <EmptyState title="No matching members" description="Try adjusting your search or filters." />
            ) : (
              visibleMembers.map((m, i) => (
                <MemberRow
                  key={m.id}
                  tournamentId={tournamentId}
                  membership={m}
                  allRoles={allRoles}
                  canTouchRole={canTouchRole}
                  locked={!canEditMember(m)}
                  isSelf={currentUser?.id === m.user.id}
                  isArchived={isArchived}
                  onUpdated={handleMemberUpdated}
                  onExpand={setExpandedId}
                  onRemove={setRemoveTarget}
                  onSelfRemove={setSelfRemoveTarget}
                  isLast={i === visibleMembers.length - 1}
                  selectMode={selectMode}
                  selected={selectedIds.has(m.id)}
                  onToggleSelect={() => toggleSelected(m.id)}
                />
              ))
            )}
          </Card>
        </>
      )}

      {expandedId !== null && (
        <MemberPanel
          tournamentId={tournamentId}
          membershipId={expandedId}
          allRoles={allRoles}
          canTouchRole={canTouchRole}
          canEditMember={canEditMember}
          onClose={() => setExpandedId(null)}
          onUpdated={handleMemberUpdated}
        />
      )}

      <SelectionBar
        visible={selectMode}
        count={selectedIds.size}
        onEdit={() => setMassEditOpen(true)}
        onCancel={toggleSelectMode}
      />

      {massEditOpen && (
        <MassRoleEditor
          tournamentId={tournamentId}
          memberships={members.filter((m) => selectedIds.has(m.id))}
          allRoles={allRoles}
          canTouchRole={canTouchRole}
          onClose={() => setMassEditOpen(false)}
          onUpdated={handleMemberUpdated}
        />
      )}

      {removeTarget && (
        <RemoveMemberModal
          tournamentId={tournamentId}
          membershipId={removeTarget.id}
          memberName={memberName(removeTarget)}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setMembers((prev) => prev && prev.filter((m) => m.id !== removeTarget.id));
            setRemoveTarget(null);
          }}
        />
      )}

      {selfRemoveTarget && (
        <SelfRemoveRedirectModal
          tournamentId={tournamentId}
          isOwner={selectedTournament?.owner_id === selfRemoveTarget.user.id}
          onClose={() => setSelfRemoveTarget(null)}
        />
      )}
    </div>
  );
}
