"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, rolesApi, MembershipSlim, Role, ApiError } from "@/lib/api";
import { formatPhone } from "@/lib/auth";
import { formatDuration, formatDateTime } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMemberRoleLock } from "@/lib/roles/useMemberRoleLock";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
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
import { MemberPanel, MEMBER_PANEL_WIDTH } from "@/components/tournament/MemberPanel";
import { MassRoleEditor, MASS_ROLE_EDITOR_WIDTH } from "@/components/tournament/MassRoleEditor";
import { RemoveMemberModal } from "@/components/tournament/RemoveMemberModal";
import { SelfRemoveRedirectModal } from "@/components/tournament/SelfRemoveRedirectModal";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { emptyFilterState } from "@/components/ui/FilterModal";
import { usePersistedFilter } from "@/lib/usePersistedFilter";
import { MembersFilterModal, isMembersFilterActive, MEMBERS_FILTER_KEYS } from "@/components/tournament/MembersFilterModal";
import { DisplayConfigModal } from "@/components/tournament/DisplayConfigModal";
import { MEMBERS_PANEL } from "@/lib/displayConfigSurfaces";
import { IconLock, IconSearch, IconArrowDown, IconExpand, IconTrash, IconMembers, IconFilter, IconX, IconEye } from "@/components/ui/Icons";

// Name / Email / Phone / Account Age / Join Date / Join Method / Roles / Actions
const MEMBER_ROW_COLUMNS = "0.8fr 1.2fr 0.6fr 90px 90px 110px 2.6fr 70px";
// Roles dropped — the fr tracks below just absorb its share automatically.
const MEMBER_ROW_COLUMNS_COMPACT = "0.8fr 1.2fr 0.6fr 90px 90px 110px 70px";
// Always present as a grid track (never conditionally added/removed) so its
// width can transition between 0 and full instead of popping in — animating
// grid-template-columns only works when the track count stays constant.
const SELECT_COLUMN_WIDTH = "28px";
function memberColumns(selectMode: boolean, panelOpen: boolean) {
  const rest = panelOpen ? MEMBER_ROW_COLUMNS_COMPACT : MEMBER_ROW_COLUMNS;
  return `${selectMode ? SELECT_COLUMN_WIDTH : "0px"} ${rest}`;
}

const DIRTY_TITLE = "Save or discard your changes first";

type SortField = "first_name" | "last_name" | "joined" | "account_age";
type SortDir = "asc" | "desc";

const SORT_FIELD_OPTIONS = [
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "joined", label: "Joined" },
  { value: "account_age", label: "Account age" },
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
  tournamentId, membership, allRoles, canTouchRole, locked, isSelf, isArchived, onUpdated, onFocus, onRemove, onSelfRemove, isLast,
  selectMode, selected, selectionLocked, onToggleSelect, focusActive, focused, rolesReadOnly, panelOpen,
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
  onFocus: () => void;
  onRemove: (membership: MembershipSlim) => void;
  onSelfRemove: (membership: MembershipSlim) => void;
  isLast: boolean;
  selectMode: boolean;
  selected: boolean;
  /** Open panel has unsaved changes — switching focus/selection is frozen until it resolves. */
  selectionLocked: boolean;
  onToggleSelect: () => void;
  /** A single-member panel is open (for some row, not necessarily this one) — rows become click-to-switch instead of inert. */
  focusActive: boolean;
  /** This row is the one currently shown in the single-member panel. */
  focused: boolean;
  /** This row's roles are open in the docked panel — don't offer a second, inline way to edit the same thing. */
  rolesReadOnly: boolean;
  /** Any docked panel is open — the table is narrower, so the Roles column drops out to give the rest room. */
  panelOpen: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const { user } = membership;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—";

  // Two different reasons a row might be clickable: toggling a checkbox in
  // Select mode, or switching which row the single-member panel shows. Never
  // both at once — the two flows are mutually exclusive.
  const clickable = (selectMode || focusActive) && !selectionLocked;
  const handleRowClick = selectMode ? onToggleSelect : onFocus;
  const highlighted = selectMode ? selected : focused;
  const lockedTitle = selectionLocked ? DIRTY_TITLE : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={clickable ? handleRowClick : undefined}
      title={(selectMode || focusActive) ? lockedTitle : undefined}
      style={{
        display: "grid", gridTemplateColumns: memberColumns(selectMode, panelOpen), alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: highlighted ? "var(--color-bg)" : hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease, grid-template-columns 200ms ease",
        cursor: clickable ? "pointer" : selectionLocked ? "not-allowed" : "default",
      }}
    >
      <span
        style={{
          display: "flex", justifyContent: "center", overflow: "hidden",
          opacity: selectMode ? 1 : 0, pointerEvents: selectMode ? "auto" : "none",
          transition: "opacity 150ms ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} locked={selectionLocked} onChange={onToggleSelect} />
      </span>
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
      {!panelOpen && (
        // Stops row clicks (select toggle / focus switch) from firing when
        // the intent was to pick a role chip.
        <div onClick={(e) => e.stopPropagation()} style={{ minWidth: 0 }}>
          <RolesCell
            tournamentId={tournamentId}
            membership={membership}
            allRoles={allRoles}
            canTouchRole={canTouchRole}
            locked={locked}
            readOnly={rolesReadOnly}
            onUpdated={onUpdated}
          />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
        {!isArchived && (
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            title={isSelf ? "Leave tournament" : locked ? "You can't remove this member." : "Remove member"}
            disabled={!isSelf && locked}
            onClick={() => (isSelf ? onSelfRemove(membership) : onRemove(membership))}
          >
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        )}
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          disabled={selectionLocked}
          title={lockedTitle ?? "Expand"}
          onClick={onFocus}
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
  // Committed filters only — the modal keeps its own draft until Apply.
  const [filters, applyFilters] = usePersistedFilter("members", currentUser?.id, tournamentId, MEMBERS_FILTER_KEYS);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showDisplayConfigModal, setShowDisplayConfigModal] = useState(false);
  // Bumped on save so the open MemberPanel remounts and refetches with the
  // just-changed hidden set — its own effect only re-runs on id changes.
  const [displayConfigVersion, setDisplayConfigVersion] = useState(0);
  const [sortField, setSortField] = useState<SortField>("joined");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [removeTarget, setRemoveTarget] = useState<MembershipSlim | null>(null);
  const [selfRemoveTarget, setSelfRemoveTarget] = useState<MembershipSlim | null>(null);

  // The two mutually-exclusive panel flows ("Expand" a single member vs.
  // Select mode) and the dirty gate that freezes both — shared with the
  // Events tab. No "creating new" flow here: members join via invite/join
  // code, so there's nothing to create from this page.
  const {
    focusedId, selectMode, selectedIds, massPanelOpen, panelDirty,
    setPanelDirty, focusItem, toggleSelectMode, toggleSelected, toggleSelectAll,
    openMassPanel, clearFocus, clearSelection, forgetItem, getPrevNext,
  } = usePanelSelection();

  // useMemberRoleLock hands back fresh closures every render, which would
  // re-register the docked panel in a loop if they went straight into the
  // effect's deps. These wrappers are stable and read the latest ones.
  const roleLockRef = useRef({ canTouchRole, canEditMember });
  useEffect(() => { roleLockRef.current = { canTouchRole, canEditMember }; });
  const canTouchRoleStable = useCallback((role: Role) => roleLockRef.current.canTouchRole(role), []);
  const canEditMemberStable = useCallback((target: MembershipSlim) => roleLockRef.current.canEditMember(target), []);

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
      // A member is hidden only when *every* role they hold is excluded —
      // otherwise someone with a kept role would vanish for holding an
      // unrelated excluded one. A member with no roles at all is never
      // hidden by this filter — deselecting every role should surface the
      // unassigned members, not hide them along with everyone else.
      const roleKeys = m.roles.map((r) => String(r.id));
      if (roleKeys.length > 0 && roleKeys.every((k) => filters.role.has(k))) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [members, search, filters, sortField, sortDir]);

  const roleFilterOptions = useMemo(
    () => allRoles.map((r) => ({ value: String(r.id), label: r.label })),
    [allRoles]
  );

  const handleMemberUpdated = useCallback((updated: MembershipSlim) => {
    setMembers((prev) => prev && prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  // Either flow narrows the table for a docked panel — drop the Roles
  // column to give the rest more room while it's up.
  const panelOpen = focusedId !== null || massPanelOpen;

  // Steps through the table's own current filter/sort order, so switching
  // sort or narrowing a filter mid-edit still lands somewhere sensible.
  const { hasPrev, hasNext, prevId, nextId } = getPrevNext(visibleMembers, (m) => m.id);

  // Only meaningful for the Select-mode flow — the panel there only opens
  // once "Edit" is pressed in the SelectionBar, not as soon as one row is
  // checked (see massPanelOpen).
  const selectedMembers = useMemo(
    () => (members ?? []).filter((m) => selectedIds.has(m.id)),
    [members, selectedIds]
  );

  const { setPanel, clearPanel } = useSetLayoutPanel();

  // The panels don't render here — they're pushed into the layout shell's
  // docked slot so the panel is a *sibling* of <main> and shrinks it, leaving
  // the table clickable. Re-runs whenever anything the panel is built from
  // changes, so the element never closes over stale props.
  useEffect(() => {
    if (focusedId !== null) {
      const membership = (members ?? []).find((m) => m.id === focusedId);
      if (!membership) { clearFocus(); return; }
      setPanel(
        <MemberPanel
          key={`${membership.id}-${displayConfigVersion}`}
          tournamentId={tournamentId}
          membershipId={membership.id}
          allRoles={allRoles}
          canTouchRole={canTouchRoleStable}
          canEditMember={canEditMemberStable}
          collectIsOver18={!!selectedTournament?.collect_is_over_18}
          collectIsOver21={!!selectedTournament?.collect_is_over_21}
          onClose={clearFocus}
          onUpdated={handleMemberUpdated}
          onPrev={() => prevId !== null && focusItem(prevId)}
          onNext={() => nextId !== null && focusItem(nextId)}
          hasPrev={hasPrev}
          hasNext={hasNext}
        />,
        MEMBER_PANEL_WIDTH,
      );
      return;
    }

    // One row checked in Select mode gets the same detail panel the focus
    // flow shows — the mass editor would be a worse view of a single member.
    if (massPanelOpen && selectedMembers.length === 1) {
      setPanel(
        <MemberPanel
          key={`${selectedMembers[0].id}-${displayConfigVersion}`}
          tournamentId={tournamentId}
          membershipId={selectedMembers[0].id}
          allRoles={allRoles}
          canTouchRole={canTouchRoleStable}
          canEditMember={canEditMemberStable}
          collectIsOver18={!!selectedTournament?.collect_is_over_18}
          collectIsOver21={!!selectedTournament?.collect_is_over_21}
          onClose={clearSelection}
          onUpdated={handleMemberUpdated}
        />,
        MEMBER_PANEL_WIDTH,
      );
      return;
    }

    if (massPanelOpen && selectedMembers.length > 1) {
      setPanel(
        <MassRoleEditor
          tournamentId={tournamentId}
          memberships={selectedMembers}
          allRoles={allRoles}
          canTouchRole={canTouchRoleStable}
          onClose={clearSelection}
          onDirtyChange={setPanelDirty}
          onUpdated={handleMemberUpdated}
        />,
        MASS_ROLE_EDITOR_WIDTH,
      );
      return;
    }

    clearPanel();
  }, [
    focusedId, members, massPanelOpen, selectedMembers, tournamentId, allRoles,
    prevId, nextId, hasPrev, hasNext, focusItem, setPanelDirty, displayConfigVersion,
    canTouchRoleStable, canEditMemberStable, handleMemberUpdated,
    clearFocus, clearSelection, setPanel, clearPanel,
  ]);

  // Unmount only (e.g. navigating off the Members page) — clearing in the
  // effect above's cleanup instead would tear the panel down on every re-run.
  useEffect(() => () => clearPanel(), [clearPanel]);

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

  const isFiltered = search.trim() !== "" || isMembersFilterActive(filters);

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
            <Button
              type="button" variant="secondary" size="md"
              onClick={() => setShowFilterModal(true)}
            >
              <IconFilter size={16} /> Filter
            </Button>
            {isMembersFilterActive(filters) && (
              <Button
                type="button" variant="ghost" size="md"
                onClick={() => applyFilters(emptyFilterState(MEMBERS_FILTER_KEYS))}
              >
                <IconX size={16} /> Clear filters
              </Button>
            )}
            <Button
              type="button" variant="secondary" size="md"
              onClick={() => setShowDisplayConfigModal(true)}
            >
              <IconEye size={16} /> Display
            </Button>
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
              <Button
                type="button" variant={selectMode ? "primary" : "secondary"} size="md"
                onClick={toggleSelectMode}
                disabled={panelDirty}
                title={panelDirty ? DIRTY_TITLE : undefined}
              >
                Select
              </Button>
            )}
          </div>

          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <div style={{
              display: "grid", gridTemplateColumns: memberColumns(selectMode, panelOpen), gap: "10px",
              transition: "grid-template-columns 200ms ease",
              padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
              fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}>
              <span
                style={{
                  display: "flex", justifyContent: "center", overflow: "hidden",
                  opacity: selectMode ? 1 : 0, pointerEvents: selectMode ? "auto" : "none",
                  transition: "opacity 150ms ease",
                }}
                title={panelDirty ? DIRTY_TITLE : undefined}
              >
                <Checkbox
                  checked={visibleMembers.length > 0 && visibleMembers.every((m) => selectedIds.has(m.id))}
                  locked={panelDirty}
                  onChange={(checked) => toggleSelectAll(visibleMembers.map((m) => m.id), checked)}
                />
              </span>
              <span>Members — {isFiltered ? `${visibleMembers.length} of ${members.length}` : members.length}</span>
              <span>Email</span>
              <span>Phone</span>
              <span style={{ textAlign: "center" }}>Account Age</span>
              <span style={{ textAlign: "center" }}>Joined</span>
              <span style={{ textAlign: "center" }}>Method</span>
              {!panelOpen && <span>Roles</span>}
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
                  onFocus={() => focusItem(m.id)}
                  onRemove={setRemoveTarget}
                  onSelfRemove={setSelfRemoveTarget}
                  isLast={i === visibleMembers.length - 1}
                  selectMode={selectMode}
                  selected={selectedIds.has(m.id)}
                  selectionLocked={panelDirty}
                  onToggleSelect={() => toggleSelected(m.id)}
                  focusActive={focusedId !== null}
                  focused={focusedId === m.id}
                  // Whichever row the open panel is editing shows its roles
                  // read-only here, so the same roles can't be edited from
                  // two places at once.
                  rolesReadOnly={focusedId === m.id || (massPanelOpen && selectedIds.has(m.id))}
                  panelOpen={panelOpen}
                />
              ))
            )}
          </Card>
        </>
      )}

      {showFilterModal && (
        <MembersFilterModal
          roleOptions={roleFilterOptions}
          filters={filters}
          onApply={applyFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}

      {showDisplayConfigModal && (
        <DisplayConfigModal
          tournamentId={tournamentId}
          surface={MEMBERS_PANEL}
          title="Configure member panel"
          onSaved={() => {
            membershipsApi.list(tournamentId)
              .then(setMembers)
              .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load members."));
            setDisplayConfigVersion((v) => v + 1);
          }}
          onClose={() => setShowDisplayConfigModal(false)}
        />
      )}

      {/* Stays up through the whole "checking boxes" phase — the panel only
          opens once Edit is pressed here, not as soon as one row is checked. */}
      <SelectionBar
        visible={selectMode && !massPanelOpen}
        count={selectedIds.size}
        onEdit={openMassPanel}
        onCancel={toggleSelectMode}
      />

      {removeTarget && (
        <RemoveMemberModal
          tournamentId={tournamentId}
          membershipId={removeTarget.id}
          memberName={memberName(removeTarget)}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setMembers((prev) => prev && prev.filter((m) => m.id !== removeTarget.id));
            // Otherwise a removed-but-still-selected/focused row would keep a
            // panel open against a member who no longer exists.
            forgetItem(removeTarget.id);
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
