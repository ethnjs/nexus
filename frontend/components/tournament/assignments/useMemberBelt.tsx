"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { MemberCard } from "@/components/tournament/assignments/MemberCard";
import {
  anyMemberFieldShown,
  DEFAULT_MEMBER_DISPLAY,
  defaultMemberDisplayForTab,
  MemberDisplayModal,
  type MemberDisplayState,
  memberDisplayFromHidden,
  memberDisplayToHidden,
  NO_MEMBER_FIELDS,
} from "@/components/tournament/assignments/MemberDisplayModal";
import {
  defaultMemberFiltersForTab,
  MEMBERS_FILTER_KEYS,
  MembersFilterModal,
  type MembersFilterState,
  membersFilterFromStored,
  membersFilterParams,
  membersFilterToStored,
} from "@/components/tournament/members/MembersFilterModal";
import { Button } from "@/components/ui/Button";
import { DisplayButton } from "@/components/ui/DisplayButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterButton } from "@/components/ui/FilterButton";
import { emptyFilterState, isFilterActive } from "@/components/ui/FilterModal";
import { IconSearch, IconUser } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { SortButton } from "@/components/ui/SortButton";
import { SortModal } from "@/components/ui/SortModal";
import table from "@/components/ui/Table.module.css";
import {
  type DisplayConfig,
  type DisplayConfigCatalog,
  displayConfigApi,
  type FilterOptionGroup,
  type MembershipFull,
  membersApi,
  type Role,
  type TournamentShift,
  type TournamentTrack,
  tabSurface,
} from "@/lib/api";
import { fullName } from "@/lib/assignments/board";
import { persistDisplayConfigSurface } from "@/lib/displayConfig";
import { FIELD_KEY_PREFIX } from "@/lib/memberColumnKeys";
import {
  isMemberSortField,
  MEMBER_SORT_TIEBREAK,
  type MemberSortField,
  memberSortOptions,
  memberSortTiebreak,
  memberSortValue,
} from "@/lib/memberSort";
import {
  type SortRule,
  sameSortRules,
  sortRows,
  sortRulesFromStored,
  sortRulesToStored,
} from "@/lib/sorting";

// A belt is scanned for a person, so alphabetical is the order you can
// predict without reading. The members table defaults to newest joins instead.
const DEFAULT_BELT_SORT: SortRule<MemberSortField>[] = [{ field: "first_name", direction: "asc" }];

interface MemberBeltOptions {
  tournamentId: number;
  enabled: boolean;
  /** The tab-scoped display-config surface this belt saves to. */
  surface: string;
  tracks: TournamentTrack[];
  /** The track tab showing; null is All. */
  activeTrackId: number | null;
  /** Whether a tab with nothing saved starts filtered to its track. Off, it starts unfiltered. */
  filterToTab?: boolean;
  members: MembershipFull[];
  /** Changes whenever assignments are written, so the server-side filters re-run. */
  refetchKey: unknown;
  roleCatalog: Role[];
  /** Given, the header grows a Select toggle that turns select mode on and off. */
  selectMode?: { active: boolean; onToggle: () => void };
}

/**
 * The member belt: the draggable card list beside a board, with its search,
 * display, filter and sort controls, saved per track tab under `surface`.
 * Returns the pieces for the caller to place: the header controls, the list,
 * and the modals, plus `belt`, the members in the order shown.
 */
export function useMemberBelt({
  tournamentId,
  enabled,
  surface: surfaceBase,
  tracks,
  activeTrackId,
  filterToTab = true,
  members,
  refetchKey,
  roleCatalog,
  selectMode,
}: MemberBeltOptions) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<MembersFilterState>(emptyFilterState(MEMBERS_FILTER_KEYS));
  const [display, setDisplay] = useState<MemberDisplayState>(DEFAULT_MEMBER_DISPLAY);
  const [sort, setSort] = useState<SortRule<MemberSortField>[]>(DEFAULT_BELT_SORT);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showDisplayModal, setShowDisplayModal] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);
  // Names every track, lunch question and custom question — what the card
  // display and sort modals offer. Same catalog the members page reads.
  const [catalog, setCatalog] = useState<DisplayConfigCatalog | null>(null);
  // Each track's preference events, for the per-event sort. Fetched the
  // first time the sort modal opens.
  const [eventPrefGroups, setEventPrefGroups] = useState<FilterOptionGroup[] | null>(null);

  const surface = tabSurface(surfaceBase, activeTrackId);
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  // What this tab shows and narrows to before anything is saved for it, and
  // what the modals' Reset buttons return to.
  const displayDefaults = useMemo(
    () => defaultMemberDisplayForTab(trackIds, activeTrackId),
    [trackIds, activeTrackId],
  );
  const filterDefaults = useMemo(
    () =>
      filterToTab
        ? defaultMemberFiltersForTab(trackIds, activeTrackId)
        : emptyFilterState(MEMBERS_FILTER_KEYS),
    [filterToTab, trackIds, activeTrackId],
  );
  const [savedConfig, setSavedConfig] = useState<DisplayConfig | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    displayConfigApi
      .get(tournamentId)
      .then((config) => {
        if (current) setSavedConfig(config);
      })
      // No saved view (or no permission to read one) is not an error.
      .catch(() => {
        if (current) setSavedConfig({});
      });
    displayConfigApi
      .getCatalog(tournamentId)
      .then((data) => {
        if (current) setCatalog(data);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [tournamentId, enabled]);

  // Re-derived per tab, so switching tabs swaps the whole view with it.
  const appliedInputs = { savedConfig, surface, filterDefaults, displayDefaults };
  const [appliedFrom, setAppliedFrom] = useState<typeof appliedInputs | null>(null);
  if (
    savedConfig !== null &&
    (appliedFrom === null ||
      appliedFrom.savedConfig !== savedConfig ||
      appliedFrom.surface !== surface ||
      appliedFrom.filterDefaults !== filterDefaults ||
      appliedFrom.displayDefaults !== displayDefaults)
  ) {
    setAppliedFrom(appliedInputs);
    const card = savedConfig[surface];
    // Nothing saved for this tab yet: the tab decides what the belt narrows
    // to. A saved `{}` is a real state (every chip cleared), so only an
    // absent one falls back.
    setFilters(card?.filters ? membersFilterFromStored(card.filters) : filterDefaults);
    setDisplay(
      Array.isArray(card?.hidden) ? memberDisplayFromHidden(card.hidden) : displayDefaults,
    );
    setSort(card?.sorts ? sortRulesFromStored(card.sorts, isMemberSortField) : DEFAULT_BELT_SORT);
  }

  /** Persists the surface and keeps the local copy in step, so switching away
   *  and back shows what was just set rather than what was last fetched. */
  const persist = useCallback(
    (patch: Record<string, unknown>) => {
      // A surface's first save has to carry the card on screen: an absent
      // `hidden` means the tab defaults, but a stored one is required and
      // defaults to [], which would read back as every field shown.
      const full =
        savedConfig?.[surface] === undefined && !("hidden" in patch)
          ? { ...patch, hidden: memberDisplayToHidden(display) }
          : patch;
      setSavedConfig((cur) => ({
        ...(cur ?? {}),
        [surface]: { hidden: [], ...(cur?.[surface] ?? {}), ...full },
      }));
      persistDisplayConfigSurface(tournamentId, surface, full);
    },
    [tournamentId, surface, savedConfig, display],
  );

  const applyFilters = useCallback(
    (next: MembersFilterState) => {
      setFilters(next);
      persist({ filters: membersFilterToStored(next) });
    },
    [persist],
  );
  const applyDisplay = useCallback(
    (next: MemberDisplayState) => {
      setDisplay(next);
      persist({ hidden: memberDisplayToHidden(next) });
    },
    [persist],
  );
  const applySort = useCallback(
    (next: SortRule<MemberSortField>[]) => {
      setSort(next);
      persist({ sorts: sortRulesToStored(next) });
    },
    [persist],
  );

  const openSortModal = useCallback(() => {
    setShowSortModal(true);
    if (eventPrefGroups === null) {
      membersApi
        .filterOptions(tournamentId)
        .then((options) => setEventPrefGroups(options.event_preferences))
        .catch(() => setEventPrefGroups([]));
    }
  }, [eventPrefGroups, tournamentId]);

  const sortFields = useMemo(
    () => memberSortOptions(catalog?.columns ?? [], eventPrefGroups ?? []),
    [catalog, eventPrefGroups],
  );

  // Against nothing, not the tab's defaults: those are filters and fields
  // too, and the toolbar's × is the one-press way to drop them.
  const filterActive = isFilterActive(filters);
  const displayActive = anyMemberFieldShown(display);
  const sortActive = !sameSortRules(sort, DEFAULT_BELT_SORT);

  // Members matching the filters, from the same server filter the members
  // page uses. Re-read after writes so the assigned filter follows a drag.
  // null = no filters set, so everyone passes.
  const filtersSet = enabled && Object.keys(membersFilterParams(filters)).length > 0;
  const [filterMatchIds, setFilterMatchIds] = useState<Set<number> | null>(null);
  // Dropped as filters clear, so setting new ones doesn't briefly show the old matches.
  if (!filtersSet && filterMatchIds !== null) setFilterMatchIds(null);
  useEffect(() => {
    const params = membersFilterParams(filters);
    if (!enabled || Object.keys(params).length === 0) return;
    let current = true;
    membersApi
      .list(tournamentId, { fields: [], filters: params })
      .then((data) => {
        if (current) setFilterMatchIds(new Set(data.map((m) => m.id)));
      })
      .catch(() => {
        if (current) setFilterMatchIds(null);
      });
    return () => {
      current = false;
    };
  }, [tournamentId, enabled, filters, refetchKey]);

  const belt = useMemo(() => {
    const text = query.trim().toLowerCase();
    const matching = members.filter((member) => {
      if (
        text &&
        !fullName(member.user ?? { first_name: null, last_name: null })
          .toLowerCase()
          .includes(text)
      )
        return false;
      if (filterMatchIds && !filterMatchIds.has(member.id)) return false;
      return true;
    });
    return sortRows(matching, sort, memberSortValue, memberSortTiebreak);
  }, [filterMatchIds, members, query, sort]);

  // Also offered beside cards shown elsewhere (the compare modal), which read `display` too.
  const displayButton = useMemo(
    () => (
      <DisplayButton
        size="sm"
        iconOnly
        label="Configure member cards"
        active={displayActive}
        onOpen={() => setShowDisplayModal(true)}
        onReset={() => applyDisplay(NO_MEMBER_FIELDS)}
        resetLabel="Hide all fields"
      />
    ),
    [displayActive, applyDisplay],
  );

  const headerActions = useMemo(
    () => (
      <>
        {displayButton}
        <FilterButton
          size="sm"
          iconOnly
          label="Filter members"
          active={filterActive}
          onOpen={() => setShowFilterModal(true)}
          onClear={() => applyFilters(emptyFilterState(MEMBERS_FILTER_KEYS))}
        />
        <SortButton
          size="sm"
          iconOnly
          label="Sort members"
          active={sortActive}
          onOpen={openSortModal}
          onReset={() => applySort(DEFAULT_BELT_SORT)}
        />
        {selectMode && (
          <Button
            type="button"
            variant={selectMode.active ? "primary" : "secondary"}
            size="sm"
            onClick={selectMode.onToggle}
          >
            Select
          </Button>
        )}
      </>
    ),
    [
      selectMode,
      displayButton,
      filterActive,
      sortActive,
      applyDisplay,
      applyFilters,
      applySort,
      displayDefaults,
      filterDefaults,
      openSortModal,
    ],
  );

  /** The search, count and cards. */
  const renderList = useCallback(
    ({
      focusedId,
      allShifts,
      onOpen,
      selectedIds,
    }: {
      focusedId: number | null;
      allShifts: TournamentShift[];
      /** In select mode, toggles the card's tick instead. */
      onOpen: (membershipId: number) => void;
      /** Given, the belt is in select mode and these cards are ticked. */
      selectedIds?: ReadonlySet<number>;
    }): ReactNode => (
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* secondary = white. primary is the same light grey as the page
            background, which would make the field disappear into it. */}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search members"
          icon={<IconSearch />}
          size="md"
          variant="secondary"
          font="sans"
          fullWidth
        />
        <span className={table.headerLabel}>
          Members — {belt.length}/{members.length}
        </span>
        {belt.length === 0 ? (
          <EmptyState
            icon={<IconUser size={24} />}
            title={query || filterActive ? "No members match" : "No members yet"}
            description={query || filterActive ? "Try a wider filter." : undefined}
            action={
              query || filterActive ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    applyFilters(emptyFilterState(MEMBERS_FILTER_KEYS));
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          belt.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              selected={selectedIds ? selectedIds.has(member.id) : focusedId === member.id}
              selecting={!!selectedIds}
              display={display}
              allShifts={allShifts}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    ),
    [belt, members.length, query, filterActive, display, applyFilters],
  );

  const modals = (
    <>
      {/* No `options` — the roster's own modal fetches the real tournament's
          filter options itself when it isn't handed pre-built ones. */}
      {showFilterModal && (
        <MembersFilterModal
          tournamentId={tournamentId}
          roleOptions={roleCatalog.map((r) => ({ value: String(r.id), label: r.label }))}
          filters={filters}
          defaults={filterDefaults}
          onApply={applyFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}
      {showDisplayModal && (
        <MemberDisplayModal
          display={display}
          defaults={displayDefaults}
          tracks={tracks.map((t) => ({ id: t.id, label: t.name }))}
          // "field_key:{key}" in the catalog; the card hides by the bare key.
          customFields={(catalog?.custom_fields ?? []).map((f) => ({
            id: f.key.slice(FIELD_KEY_PREFIX.length),
            label: f.label,
          }))}
          onApply={applyDisplay}
          onClose={() => setShowDisplayModal(false)}
        />
      )}
      {showSortModal && (
        <SortModal
          title="Sort members"
          fields={sortFields}
          rules={sort}
          defaults={DEFAULT_BELT_SORT}
          tiebreakLabel={MEMBER_SORT_TIEBREAK}
          onApply={(next) => applySort(next as SortRule<MemberSortField>[])}
          onClose={() => setShowSortModal(false)}
        />
      )}
    </>
  );

  return { belt, headerActions, renderList, modals, display, displayButton };
}
