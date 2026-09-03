"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  membershipsApi, rolesApi, displayConfigApi, MembershipSlim, Role, ApiError,
  DisplayConfig, DisplayConfigCatalogItem, DisplayConfigSurface,
} from "@/lib/api";
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
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Checkbox } from "@/components/ui/Checkbox";
import { RolesCell } from "@/components/tournament/RolesCell";
import { MemberPanel, MEMBER_PANEL_WIDTH } from "@/components/tournament/MemberPanel";
import { MassRoleEditor, MASS_ROLE_EDITOR_WIDTH } from "@/components/tournament/MassRoleEditor";
import { RemoveMemberModal } from "@/components/tournament/RemoveMemberModal";
import { SelfRemoveRedirectModal } from "@/components/tournament/SelfRemoveRedirectModal";
import { SelectionBar } from "@/components/ui/SelectionBar";
import {
  MembersFilterModal, MembersFilterState, isMembersFilterActive, membersFilterParams,
  membersFilterFromStored, emptyMembersFilter,
} from "@/components/tournament/MembersFilterModal";
import { TableColumnsModal } from "@/components/tournament/TableColumnsModal";
import { COLUMN_WIDTHS, MemberColumn, compactTrack, resolveColumns, rolesWidth } from "@/components/tournament/memberColumns";
import styles from "@/components/tournament/MembersTable.module.css";
import { MEMBERS_TABLE } from "@/lib/displayConfigSurfaces";
import { IconLock, IconSearch, IconArrowDown, IconExpand, IconTrash, IconMembers, IconFilter, IconX, IconEye } from "@/components/ui/Icons";

// Always present as a grid track (never conditionally added/removed) so its
// width can transition between 0 and full instead of popping in — animating
// grid-template-columns only works when the track count stays constant.
const SELECT_COLUMN_WIDTH = "28px";

// Mirrors the backend's DEFAULT_COLUMNS — what a tournament with nothing
// saved shows, i.e. roughly the table as it was before it became configurable.
const DEFAULT_TABLE_COLUMNS = ["email", "phone", "account_age", "joined", "method"];

// Select / Name / ...configured columns... / Roles / Actions. Name, roles and
// actions aren't configurable: they're the row's identity and its controls,
// not data a TD would turn off.
//
// Every track is always present. Select and Roles collapse to zero width
// rather than dropping out, for the reason SELECT_COLUMN_WIDTH documents
// above: grid-template-columns interpolates position-by-position, so a list
// that changes length (or swaps a minmax() for a plain length) can't
// transition at all and snaps instead. Roles used to drop out, which is why
// the table jumped while the panel animated open beside it.
function memberColumns(selectMode: boolean, panelOpen: boolean, columns: MemberColumn[]) {
  // With the panel open the table is squeezed, so the tracks that can give
  // do — see compactTrack. Same track types either way, so the template
  // still interpolates as the panel slides.
  const track = (width: string) => (panelOpen ? compactTrack(width) : width);
  return [
    selectMode ? SELECT_COLUMN_WIDTH : "0px",
    track(COLUMN_WIDTHS.name),
    ...columns.map((column) => track(column.width)),
    panelOpen ? COLUMN_WIDTHS.rolesCollapsed : rolesWidth(columns.length),
    // Actions collapses with the panel too: its Remove lives in the panel
    // header while one is open, and Expand is meaningless when the row is
    // already expanded. Plain length either way so the track still animates.
    panelOpen ? "0px" : COLUMN_WIDTHS.actions,
  ].join(" ");
}

// Matches the column transition, so the Roles chips only come back into
// layout once the track that holds them has finished widening.
const ROLES_REVEAL_MS = 220;

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

// memo'd because the parent re-renders on every keystroke in Search, every
// selection change and every panel re-registration. Without it each of those
// re-rendered every row's AvatarCircle, Tooltip and RolesCell subtree. All
// callback props below are id-based and reference-stable in the parent, which
// is what makes the memo actually hold.
const MemberRow = memo(function MemberRow({
  tournamentId, membership, allRoles, canTouchRole, locked, isSelf, isArchived, onUpdated, onFocus, onRemove, onSelfRemove,
  selectMode, selected, selectionLocked, onToggleSelect, focusActive, focused, rolesReadOnly, panelOpen,
  columns,
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
  onFocus: (id: number) => void;
  onRemove: (membership: MembershipSlim) => void;
  onSelfRemove: (membership: MembershipSlim) => void;
  selectMode: boolean;
  selected: boolean;
  /** Open panel has unsaved changes — switching focus/selection is frozen until it resolves. */
  selectionLocked: boolean;
  onToggleSelect: (id: number) => void;
  /** A single-member panel is open (for some row, not necessarily this one) — rows become click-to-switch instead of inert. */
  focusActive: boolean;
  /** This row is the one currently shown in the single-member panel. */
  focused: boolean;
  /** This row's roles are open in the docked panel — don't offer a second, inline way to edit the same thing. */
  rolesReadOnly: boolean;
  /** Any docked panel is open — the table is narrower, so the Roles column collapses to give the rest room. */
  panelOpen: boolean;
  /** The configured columns, already resolved from the saved display config. */
  columns: MemberColumn[];
}) {
  const { user } = membership;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—";

  // Two different reasons a row might be clickable: toggling a checkbox in
  // Select mode, or switching which row the single-member panel shows. Never
  // both at once — the two flows are mutually exclusive.
  const clickable = (selectMode || focusActive) && !selectionLocked;
  const handleRowClick = selectMode ? () => onToggleSelect(membership.id) : () => onFocus(membership.id);
  const highlighted = selectMode ? selected : focused;
  const lockedTitle = selectionLocked ? DIRTY_TITLE : undefined;

  return (
    <div
      className={styles.row}
      // Hover is styled in CSS; only the "this row is the open one" state
      // needs to reach the stylesheet from React.
      data-active={highlighted ? "true" : undefined}
      onClick={clickable ? handleRowClick : undefined}
      title={(selectMode || focusActive) ? lockedTitle : undefined}
      style={{ cursor: clickable ? "pointer" : selectionLocked ? "not-allowed" : "default" }}
    >
      <span
        className={`${styles.collapsible} ${selectMode ? "" : styles.collapsed}`}
        style={{ display: "flex", justifyContent: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} locked={selectionLocked} onChange={() => onToggleSelect(membership.id)} />
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
      {columns.map((column) => (
        <div
          key={column.key}
          style={{
            minWidth: 0, display: "flex",
            justifyContent: column.align === "start" ? "flex-start" : "center",
          }}
        >
          {column.render(membership)}
        </div>
      ))}
      {/* Stays mounted while a panel is open — its track animates to zero
          width instead of being removed, which is the only way the template
          can transition. Whether its contents are actually laid out is driven
          by data-roles-hidden on the table, not from here, so restoring them
          on close doesn't re-render every row. readOnly while collapsed keeps
          the Popover (and its scroll/resize listeners) out of the tree.
          Stops row clicks (select toggle / focus switch) from firing when the
          intent was to pick a role chip. */}
      <div className={styles.rolesCell} onClick={(e) => e.stopPropagation()}>
        <RolesCell
          tournamentId={tournamentId}
          membership={membership}
          allRoles={allRoles}
          canTouchRole={canTouchRole}
          locked={locked}
          readOnly={rolesReadOnly || panelOpen}
          onUpdated={onUpdated}
        />
      </div>
      {/* Same collapse treatment as the Roles cell, driven by the same
          data attribute on the table — see .actionsCell. */}
      <div
        className={styles.actionsCell}
        style={{ display: "flex", justifyContent: "center", gap: "4px" }}
        onClick={(e) => e.stopPropagation()}
      >
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
          onClick={() => onFocus(membership.id)}
        >
          <IconExpand size={13} />
        </Button>
      </div>
    </div>
  );
});

export default function MembersPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tournamentId = Number(params.id);

  // Read once, on the first render only: from here on the URL follows the
  // page's state, not the other way round, so re-reading it would fight the
  // router.replace below. Filters aren't here — they're saved server-side in
  // this viewer's display config, which already survives a refresh.
  const [initialMemberId] = useState(() => Number(searchParams.get("member")) || null);

  const { user: currentUser } = useAuth();
  const { selectedTournament } = useTournament();
  const { canManageMembers, isArchived, membershipLoading, canTouchRole, canEditMember } = useMemberRoleLock();

  const [members, setMembers] = useState<MembershipSlim[] | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  // Committed filters only — the modal keeps its own draft until Apply.
  // Filters, sort and columns are all this viewer's own display config now,
  // so they arrive in the one GET below and are written back by persistView.
  const [filters, setFilters] = useState<MembersFilterState>(() => emptyMembersFilter());
  // The whole config as last read, so a write can lay this surface's view
  // state over the other surfaces instead of replacing them.
  const [viewReady, setViewReady] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showTableColumnsModal, setShowTableColumnsModal] = useState(false);
  // Bumped on save so the open MemberPanel remounts and refetches with the
  // just-changed hidden set — its own effect only re-runs on id changes.
  const [displayConfigVersion, setDisplayConfigVersion] = useState(0);
  // null = nothing saved, so use DEFAULT_TABLE_COLUMNS. An empty array is a
  // real answer ("show no data columns") and must not fall back.
  const [columnKeys, setColumnKeys] = useState<string[] | null>(null);
  const [columnCatalog, setColumnCatalog] = useState<DisplayConfigCatalogItem[]>([]);
  // Saved with the filters, and for the same reason: a coordinator who sorts
  // by last name is still sorting by last name tomorrow, on any device.
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
  } = usePanelSelection({ initialFocusedId: initialMemberId });

  // The URL mirrors whichever member's panel is open, so a refresh comes
  // back to it. replace, not push: this is where you already are, and every
  // row you click would otherwise cost a Back press to undo.
  useEffect(() => {
    const search = focusedId !== null ? `?member=${focusedId}` : "";
    if (search === window.location.search) return;
    router.replace(`${pathname}${search}`, { scroll: false });
  }, [focusedId, pathname, router]);

  // useMemberRoleLock hands back fresh closures every render, which would
  // re-register the docked panel in a loop if they went straight into the
  // effect's deps. These wrappers are stable and read the latest ones.
  const roleLockRef = useRef({ canTouchRole, canEditMember });
  useEffect(() => { roleLockRef.current = { canTouchRole, canEditMember }; });
  const canTouchRoleStable = useCallback((role: Role) => roleLockRef.current.canTouchRole(role), []);
  const canEditMemberStable = useCallback((target: MembershipSlim) => roleLockRef.current.canEditMember(target), []);

  // Same ref trick, for a different reason: toggleSelected's identity changes
  // every time the selection does, and focusItem's whenever the dirty flag
  // does. Handed straight to a memo'd MemberRow those would defeat the memo
  // and re-render every row on each checkbox click.
  const selectionRef = useRef({ focusItem, toggleSelected });
  useEffect(() => { selectionRef.current = { focusItem, toggleSelected }; });
  const focusItemStable = useCallback((id: number) => selectionRef.current.focusItem(id), []);
  const toggleSelectedStable = useCallback((id: number) => selectionRef.current.toggleSelected(id), []);

  // Held until the saved filters have been read: filtering runs server-side,
  // so firing on the initial empty state would put an unfiltered request in
  // flight alongside the filtered one — and the unfiltered one, being the
  // bigger query, tends to land second and win.
  useEffect(() => {
    if (!canManageMembers || !viewReady) return;
    // A filter change mid-flight has the same race on a smaller scale, so a
    // superseded response is dropped rather than allowed to overwrite.
    let current = true;
    membershipsApi.list(tournamentId, {
      surface: MEMBERS_TABLE,
      filters: membersFilterParams(filters),
    })
      .then((rows) => { if (current) setMembers(rows); })
      .catch((e) => { if (current) setLoadError(e instanceof ApiError ? e.message : "Failed to load members."); });
    rolesApi.list(tournamentId).then((roles) => { if (current) setAllRoles(roles); }).catch(() => setAllRoles([]));
    return () => { current = false; };
  }, [tournamentId, canManageMembers, viewReady, displayConfigVersion, filters]);

  // This viewer's saved view of the table — columns, filters and sort — plus
  // the catalog that names each column key. Both halves are needed before a
  // column can render: the config says which, the catalog says what to call
  // them. Filters gate the roster fetch below, so this has to land first.
  useEffect(() => {
    if (!canManageMembers) return;
    Promise.all([
      displayConfigApi.get(tournamentId).catch(() => ({} as DisplayConfig)),
      displayConfigApi.getCatalog(tournamentId).catch(() => null),
    ]).then(([config, catalog]) => {
      const surface = config?.[MEMBERS_TABLE];
      setColumnKeys(surface?.columns ?? null);
      setColumnCatalog(catalog?.columns ?? []);
      // Only on the first load: a re-read after a Display save must not
      // stomp filters the coordinator changed while that modal was open.
      setViewReady((already) => {
        if (already) return true;
        setFilters(membersFilterFromStored(surface?.filters));
        if (surface?.sort && SORT_FIELD_OPTIONS.some((o) => o.value === surface.sort!.field)) {
          setSortField(surface.sort.field as SortField);
          setSortDir(surface.sort.direction === "asc" ? "asc" : "desc");
        }
        return true;
      });
    });
  }, [tournamentId, canManageMembers, displayConfigVersion]);

  // Write-back for the view state this page owns (filters, sort). Re-reads
  // before writing because a PUT replaces every surface at once and the
  // Display modal writes columns into this same surface — see
  // useDisplayConfigDraft, which merges from the other side for the same
  // reason. Fire-and-forget: failing to remember a sort order is not worth
  // interrupting the table over.
  const persistView = useCallback((patch: Partial<DisplayConfigSurface>) => {
    displayConfigApi.get(tournamentId)
      .then((fresh) => displayConfigApi.set(tournamentId, {
        ...fresh,
        // A surface that has never been saved still needs its required
        // `hidden` key, hence the spread order.
        [MEMBERS_TABLE]: { ...{ hidden: [] }, ...fresh[MEMBERS_TABLE], ...patch },
      }))
      .catch(() => {});
  }, [tournamentId]);

  const applyFilters = useCallback((next: MembersFilterState) => {
    setFilters(next);
    persistView({ filters: membersFilterParams(next) });
  }, [persistView]);

  const applySort = useCallback((field: SortField, direction: SortDir) => {
    setSortField(field);
    setSortDir(direction);
    persistView({ sort: { field, direction } });
  }, [persistView]);

  const tableColumns = useMemo(() => {
    const labels = new Map(columnCatalog.map((item) => [item.key, item.label]));
    // A saved list of [] means "no columns"; only a missing one falls back to
    // the defaults, which is why null and [] are kept apart.
    const keys = columnKeys ?? DEFAULT_TABLE_COLUMNS;
    return resolveColumns(
      keys, labels,
      !!selectedTournament?.collect_is_over_18,
      !!selectedTournament?.collect_is_over_21,
    );
  }, [columnKeys, columnCatalog, selectedTournament]);

  const visibleMembers = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    const filtered = members.filter((m) => {
      if (q && !memberName(m).toLowerCase().includes(q) && !m.user.email.toLowerCase().includes(q)) return false;
      // Filtering is the server's job now — every filter matches against
      // data the roster doesn't carry. Only search stays here, since it
      // reads fields already on the row.
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

  // Whether the Roles chips participate in layout at all (see .rolesCell).
  // Asymmetric on purpose: they drop out the instant a panel opens, so the
  // collapsing column never has to wrap them at a few px wide, but they only
  // come back once the column has finished widening again. Kept as a data
  // attribute on the single table element rather than a row prop — flipping it
  // is then a CSS cascade change instead of a re-render of every row.
  const [prevPanelOpen, setPrevPanelOpen] = useState(panelOpen);
  const [rolesLaidOut, setRolesLaidOut] = useState(!panelOpen);
  if (panelOpen !== prevPanelOpen) {
    setPrevPanelOpen(panelOpen);
    if (panelOpen) setRolesLaidOut(false);
  }
  useEffect(() => {
    if (panelOpen) return;
    const timer = setTimeout(() => setRolesLaidOut(true), ROLES_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [panelOpen]);

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
      // Nothing loaded yet says nothing about whether the row exists — on a
      // refresh into ?member=, focus is seeded before the roster arrives, and
      // treating "not in an empty list" as "gone" would drop it every time.
      if (members === null) return;
      const membership = members.find((m) => m.id === focusedId);
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
          isArchived={isArchived}
          isSelf={currentUser?.id === membership.user.id}
          onRemove={setRemoveTarget}
          onSelfRemove={setSelfRemoveTarget}
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
          isArchived={isArchived}
          isSelf={currentUser?.id === selectedMembers[0].user.id}
          onRemove={setRemoveTarget}
          onSelfRemove={setSelfRemoveTarget}
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
    canTouchRoleStable, canEditMemberStable, handleMemberUpdated, isArchived, currentUser?.id,
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
                onClick={() => applyFilters(emptyMembersFilter())}
              >
                <IconX size={16} /> Clear filters
              </Button>
            )}
            <Button
              type="button" variant="secondary" size="md"
              onClick={() => setShowTableColumnsModal(true)}
            >
              <IconEye size={16} /> Display
            </Button>
            <Dropdown
              label="Sort by"
              value={sortField}
              onChange={(v) => applySort(v as SortField, sortDir)}
              options={SORT_FIELD_OPTIONS}
              size="md"
              variant="secondary"
              width={150}
            />
            <Button
              type="button" variant="secondary" size="md" iconOnly
              title={sortDir === "asc" ? "Ascending" : "Descending"}
              onClick={() => applySort(sortField, sortDir === "asc" ? "desc" : "asc")}
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
            {/* One grid for the whole table: it owns the column tracks and is
                the only element that transitions them. Header and rows are
                subgrids, so resizing (the docked panel sliding open shrinks
                this container every frame) costs one track resolution instead
                of one per row. */}
            <div
              className={styles.table}
              data-roles-hidden={rolesLaidOut ? undefined : "true"}
              style={{ gridTemplateColumns: memberColumns(selectMode, panelOpen, tableColumns) }}
            >
              <div className={styles.header}>
                <span
                  className={`${styles.collapsible} ${selectMode ? "" : styles.collapsed}`}
                  style={{ display: "flex", justifyContent: "center" }}
                  title={panelDirty ? DIRTY_TITLE : undefined}
                >
                  <Checkbox
                    checked={visibleMembers.length > 0 && visibleMembers.every((m) => selectedIds.has(m.id))}
                    locked={panelDirty}
                    onChange={(checked) => toggleSelectAll(visibleMembers.map((m) => m.id), checked)}
                  />
                </span>
                <span>Members — {isFiltered ? `${visibleMembers.length} of ${members.length}` : members.length}</span>
                {tableColumns.map((column) => (
                  <span
                    key={column.key}
                    style={{
                      textAlign: column.align === "start" ? "left" : "center",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                    title={column.label}
                  >
                    {column.label}
                  </span>
                ))}
                <span className={styles.rolesCell}>Roles</span>
                {/* Ellipses like every other header rather than spilling past
                    the card edge if the grid is ever squeezed past its floors. */}
                <span className={styles.actionsCell} style={{ textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Actions</span>
              </div>

              {visibleMembers.map((m) => (
                <MemberRow
                  key={m.id}
                  tournamentId={tournamentId}
                  membership={m}
                  allRoles={allRoles}
                  canTouchRole={canTouchRoleStable}
                  locked={!canEditMember(m)}
                  isSelf={currentUser?.id === m.user.id}
                  isArchived={isArchived}
                  onUpdated={handleMemberUpdated}
                  onFocus={focusItemStable}
                  onRemove={setRemoveTarget}
                  onSelfRemove={setSelfRemoveTarget}
                  selectMode={selectMode}
                  selected={selectedIds.has(m.id)}
                  selectionLocked={panelDirty}
                  onToggleSelect={toggleSelectedStable}
                  focusActive={focusedId !== null}
                  focused={focusedId === m.id}
                  // Whichever row the open panel is editing shows its roles
                  // read-only here, so the same roles can't be edited from
                  // two places at once.
                  columns={tableColumns}
                  rolesReadOnly={focusedId === m.id || (massPanelOpen && selectedIds.has(m.id))}
                  panelOpen={panelOpen}
                />
              ))}
            </div>

            {visibleMembers.length === 0 && (
              <EmptyState title="No matching members" description="Try adjusting your search or filters." />
            )}
          </Card>
        </>
      )}

      {showFilterModal && (
        <MembersFilterModal
          tournamentId={tournamentId}
          roleOptions={roleFilterOptions}
          filters={filters}
          onApply={applyFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}

      {/* The page's Display button configures the *table*. The panel has its
          own button in its own header — each surface is edited where it's
          visible, rather than one modal serving both. */}
      {showTableColumnsModal && (
        <TableColumnsModal
          tournamentId={tournamentId}
          onSaved={() => setDisplayConfigVersion((v) => v + 1)}
          onClose={() => setShowTableColumnsModal(false)}
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
