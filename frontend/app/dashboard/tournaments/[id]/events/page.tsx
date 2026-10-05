"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  tournamentEventsApi, tournamentShiftsApi, tournamentTracksApi, canonicalEventsApi,
  buildingsApi, rolesApi, assignmentsApi, TournamentBuilding, Role, Assignment,
  displayConfigApi, ApiError, DisplayConfig, DisplayConfigSurface,
  TournamentEvent, TournamentEventInput, TournamentDivision, TournamentTrack, TournamentShift, CanonicalEvent,
} from "@/lib/api";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import { useTournament } from "@/lib/useTournament";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { useToast } from "@/lib/useToast";
import { rowActivation } from "@/lib/rowActivation";
import { persistSurfaceView } from "@/lib/persistSurfaceView";
import { handleGridArrows } from "@/lib/gridNav";
import { useElementNarrowerThan } from "@/lib/useElementNarrowerThan";
import { assignmentsByEvent } from "@/lib/assignments/flags";
import {
  EVENT_SORT_OPTIONS, EVENT_SORT_TIEBREAK, eventSortTiebreak, eventSortValue, isEventSortField, type EventSortField,
} from "@/lib/eventSort";
import {
  cycleSortRule, sameSortRules, sortRows, sortRulesFromStored, sortRulesToStored, type SortRule,
} from "@/lib/sorting";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { SortButton } from "@/components/ui/SortButton";
import { EditableText } from "@/components/ui/EditableText";
import { CellGuard, ConfirmRequest, EventEditContext, LockedCell } from "@/components/tournament/events/EditableCells";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ensureBuildingOnTrack } from "@/lib/buildings";
import { DisplayButton } from "@/components/ui/DisplayButton";
import { SortModal } from "@/components/ui/SortModal";
import { Card } from "@/components/ui/Card";
import table from "@/components/ui/Table.module.css";
import { Button } from "@/components/ui/Button";
import { PendingTrackBanner } from "@/components/tournament/PendingTrackBanner";
import { toTrackDetailInput } from "@/lib/eventTrackDetails";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { IconSearch, IconEvents, IconWarning, IconPlus, IconTrash, IconLock, IconCopy } from "@/components/ui/Icons";
import { LoadDefaultEventsModal } from "@/components/tournament/events/LoadDefaultEventsModal";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { useInitialPanelId, usePanelUrlSync } from "@/lib/usePanelUrl";
import { EventPanel, EVENT_PANEL_WIDTH } from "@/components/tournament/events/EventPanel";
import { DeleteEventModal } from "@/components/tournament/events/DeleteEventModal";
import {
  EventsFilterModal, EventsFilterState, isEventsFilterActive, EVENTS_FILTER_KEYS,
  EVENT_FILTER_UNSET, eventCategoryOptions, eventTrackOptions, eventBuildingOptions, eventShiftOptions,
  eventPassesFilters, eventsFilterFromStored, eventsFilterToStored, EVENT_TYPE_OPTIONS,
} from "@/components/tournament/events/EventsFilterModal";
import { emptyFilterState } from "@/components/ui/FilterModal";
import { EventsColumnsModal } from "@/components/tournament/events/EventsColumnsModal";
import {
  DEFAULT_EVENT_COLUMNS, EVENT_COLUMN_WIDTHS, EventColumn, resolveEventColumns, trackFamilyOf,
} from "@/components/tournament/events/eventColumns";
import { EVENTS_TABLE } from "@/lib/displayConfigSurfaces";
import { MassEventEditor, MASS_EVENT_EDITOR_WIDTH } from "@/components/tournament/events/MassEventEditor";
import { eventName } from "@/lib/eventDisplay";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { FilterButton } from "@/components/ui/FilterButton";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";

// Always present as a grid track (never conditionally added/removed) so its
// width can transition between 0 and full instead of popping in — animating
// grid-template-columns only works when the track count stays constant.
const SELECT_COLUMN_WIDTH = "28px";

// Stable empty list, so an event with no assignments doesn't get a fresh array per cell.
const NO_ASSIGNMENTS: readonly Assignment[] = [];

// Name and Actions bracket the configured columns: the row's identity and
// its controls, which is why neither is a column a TD can turn off.
function eventGridColumns(selectMode: boolean, columns: EventColumn[]) {
  return [
    selectMode ? SELECT_COLUMN_WIDTH : "0px",
    EVENT_COLUMN_WIDTHS.name,
    ...columns.map((column) => column.width),
    EVENT_COLUMN_WIDTHS.actions,
  ].join(" ");
}

// Start time first, which is what the table sorted by before it took a chain.
const DEFAULT_TABLE_SORT: SortRule<EventSortField>[] = [{ field: "start", direction: "asc" }];

// Every field counts every track — the table has no tabs to narrow by.
const ALL_TRACKS = () => true;

/** The single `sort` this table saved before it took a chain, as one. */
function legacySortRules(sort: { field: string; direction?: string } | null | undefined): SortRule<EventSortField>[] | null {
  const field = sort?.field === "day" ? "start" : sort?.field === "name" || sort?.field === "division" ? sort.field : null;
  return field ? [{ field, direction: sort?.direction === "desc" ? "desc" : "asc" }] : null;
}

export default function EventsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();

  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;
  const canManageEvents = isAdmin || isOwner || hasPermission("manage_events");

  const router = useRouter();
  const { selectedTournament } = useTournament();
  const { isArchived, archivedReason } = useArchiveLock();
  const divisions = selectedTournament?.division ?? [];
  const hasDivisions = divisions.length > 0;

  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [showLoadModal, setShowLoadModal] = useState(false);
  // Creating a new event is the one panel that isn't driven by selection —
  // there's no row to select yet.
  const [creatingNew, setCreatingNew] = useState(false);
  // Bumped per Add click and used as the create panel's key, so Add always
  // opens a blank draft even when the create panel is already up.
  const [createKey, setCreateKey] = useState(0);
  // One event from a row's trash button, or the whole selection from the toolbar.
  const [deleteTargets, setDeleteTargets] = useState<TournamentEvent[] | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const { show } = useToast();
  // Bumped on a Display save so the effect below re-reads the just-saved
  // columns — it otherwise only runs on a tournament change.
  const [displayConfigVersion, setDisplayConfigVersion] = useState(0);
  // Catalogs the panel needs, loaded once here: the panel remounts per event,
  // so fetching them there re-requested all three on every arrow press.
  const [canonicalEvents, setCanonicalEvents] = useState<CanonicalEvent[]>([]);
  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);
  // A table edit that asked first (see EventEditContext.confirm).
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  // Below this the labelled toolbar no longer fits on one line (search at its
  // minimum plus every button), so the buttons drop to icons instead of the
  // row wrapping. Select keeps its word — it has no icon that says "select".
  const [toolbarRef, compactToolbar] = useElementNarrowerThan<HTMLDivElement>(900);
  // Every live track, competition day or not: an event can belong to an
  // undated one (Test Writing).
  const [tracks, setTracks] = useState<TournamentTrack[]>([]);
  // Null until a staffing column asks for them (see the fetch below).
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  // The panel's location and staffing editors pick from these: a building is
  // a catalog row now, and every staffing line names a role.
  const [buildings, setBuildings] = useState<TournamentBuilding[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  // Bumped when the tab regains focus, so collaborators' changes show up.
  const [refreshKey, setRefreshKey] = useState(0);
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1));
  // Replace-or-append: tagging an existing building onto a track comes back
  // as that same row with a longer track_ids.
  const handleBuildingSaved = useCallback((building: TournamentBuilding) => {
    setBuildings((cur) => (
      cur.some((b) => b.id === building.id)
        ? cur.map((b) => (b.id === building.id ? building : b))
        : [...cur, building].sort((a, b) => a.name.localeCompare(b.name))
    ));
  }, []);
  const handleShiftCreated = useCallback(
    (shift: TournamentShift) => setAllShifts((prev) => [...(prev ?? []), shift]),
    [],
  );

  const [search, setSearch] = useState("");
  // Committed filters only — the modal keeps its own draft until Apply.
  // Filters, sort and columns are all this viewer's own display config, so
  // they arrive in the one GET below and are written back by persistView.
  // Per member and per tournament by construction now, which is what the old
  // localStorage key had to spell out by hand — and they follow a
  // coordinator to whatever device they open the tournament on.
  const [filters, setFilters] = useState<EventsFilterState>(() => emptyFilterState(EVENTS_FILTER_KEYS));
  // Gates the table: filtering is client-side, so rendering before the saved
  // filters land would show every event for a frame and then narrow.
  const [viewReady, setViewReady] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showColumnsModal, setShowColumnsModal] = useState(false);
  // null = nothing saved, so use DEFAULT_EVENT_COLUMNS. An empty array is a
  // real answer ("show no data columns") and must not fall back.
  const [columnKeys, setColumnKeys] = useState<string[] | null>(null);
  const [sortRules, setSortRules] = useState<SortRule<EventSortField>[]>(DEFAULT_TABLE_SORT);
  const [showSortModal, setShowSortModal] = useState(false);

  const initialEventId = useInitialPanelId("event");

  // The two mutually-exclusive panel flows (single-focus vs. Select mode) and
  // the dirty gate that freezes both — shared with the Members page.
  // onClearExternal drops a still-blank "new event" draft when either flow
  // takes the panel over; it never needs to clear panelDirty, since both of
  // those transitions are already blocked while dirty.
  const {
    focusedId: focusedEventId, selectMode, selectedIds, massPanelOpen, panelDirty,
    setPanelDirty, focusItem: focusEvent, toggleSelectMode, toggleSelected, toggleSelectAll,
    openMassPanel, clearFocus, clearSelection, forgetItem, startExternalFlow, getPrevNext,
  } = usePanelSelection({
    onClearExternal: () => setCreatingNew(false),
    initialFocusedId: initialEventId,
  });
  // The URL mirrors whichever event's panel is open, so a refresh — or a
  // pasted link — comes back to it. Only the single-focus flow: a mass
  // selection is a working set, not a place.
  usePanelUrlSync("event", focusedEventId);

  // Stable identity: it's a dependency of the layout-panel effect below, and
  // a fresh closure each render would re-register the panel every render.
  const clearCreatingNew = useCallback(() => {
    setCreatingNew(false);
    setPanelDirty(false);
  }, [setPanelDirty]);

  // Stable, so the memoised rows can share it.
  const confirmDelete = useCallback((event: TournamentEvent) => setDeleteTargets([event]), []);

  // Blocked while dirty and clears whatever else was open — otherwise this
  // would silently replace a focused event or an in-progress selection with a
  // blank "new event" draft with no warning.
  function handleAddEvent() {
    startExternalFlow(() => {
      setCreatingNew(true);
      setCreateKey((k) => k + 1);
    });
  }

  // Gated on the permission, and re-run when it lands: the table used to be a
  // child that only mounted once the check had passed, so unmounted meant
  // unfetched. Inlined, this effect runs on the first render too — while
  // membership is still loading and the answer is a provisional false.
  //
  // The fetch is written out here rather than kept as a loadEvents() helper:
  // it had exactly one caller (every other change to the list is applied
  // locally by a panel's onSaved/onDeleted), and a helper that sets state is
  // a helper an effect cannot call without looking like a synchronous
  // setState. Inline, the writes are plainly in a promise callback, and the
  // `current` flag drops a response that lands after a tournament switch.
  useEffect(() => {
    if (!canManageEvents) return;
    let current = true;
    tournamentEventsApi.list(tournamentId)
      .then((next) => { if (current) setEvents(next); })
      .catch((err: unknown) => {
        if (!current) return;
        setLoadError(err instanceof ApiError ? err.message : "Failed to load events.");
      });
    return () => { current = false; };
  }, [tournamentId, canManageEvents, refreshKey]);

  useEffect(() => {
    if (!canManageEvents) return;
    let current = true;
    tournamentShiftsApi.list(tournamentId)
      .then((next) => { if (current) setAllShifts(next); })
      .catch(() => { if (current) setAllShifts([]); });
    tournamentTracksApi.list(tournamentId, { public: true })
      .then((next) => { if (current) setTracks(next); })
      .catch(() => { if (current) setTracks([]); });
    buildingsApi.list(tournamentId)
      .then((next) => { if (current) setBuildings(next); })
      .catch(() => { if (current) setBuildings([]); });
    rolesApi.list(tournamentId)
      .then((next) => { if (current) setRoles(next); })
      .catch(() => { if (current) setRoles([]); });
    return () => { current = false; };
  }, [tournamentId, canManageEvents, refreshKey]);

  // The global catalog — changes on an admin's schedule, not a tournament's.
  useEffect(() => {
    canonicalEventsApi.list().then(setCanonicalEvents).catch(() => {});
  }, []);

  // This viewer's saved view of the table — columns, filters and sort. The
  // catalog isn't needed here (unlike the roster's): every events column is a
  // fixed key with a label the client already knows, so nothing has to be
  // looked up before a column can render.
  useEffect(() => {
    // Nothing to read without the permission the config route wants. Nothing
    // to release either: viewReady only gates the table, and a viewer without
    // the permission never reaches it — the no-access card returns first.
    if (!canManageEvents) return;
    let current = true;
    displayConfigApi.get(tournamentId)
      .catch(() => ({} as DisplayConfig))
      .then((config) => {
        if (!current) return;
        const surface = config?.[EVENTS_TABLE];
        setColumnKeys(surface?.columns ?? null);
        // Only on the first load: a re-read after a Display save must not
        // stomp filters the coordinator changed while that modal was open.
        setViewReady((already) => {
          if (already) return true;
          setFilters(eventsFilterFromStored(surface?.filters));
          setSortRules(surface?.sorts
            ? sortRulesFromStored(surface.sorts, isEventSortField)
            : legacySortRules(surface?.sort) ?? DEFAULT_TABLE_SORT);
          return true;
        });
      });
    return () => { current = false; };
  }, [tournamentId, canManageEvents, displayConfigVersion]);

  // Write-back for the view state this tab owns (filters, sort, a reset of
  // columns) — see persistSurfaceView for why it re-reads first.
  const persistView = useCallback(
    (patch: Partial<DisplayConfigSurface>) => persistSurfaceView(tournamentId, EVENTS_TABLE, patch),
    [tournamentId],
  );

  const applyFilters = useCallback((next: EventsFilterState) => {
    setFilters(next);
    persistView({ filters: eventsFilterToStored(next) });
  }, [persistView]);

  // Clears the legacy `sort` as it writes the chain, so the two never disagree.
  const applySort = useCallback((next: SortRule<EventSortField>[]) => {
    setSortRules(next);
    persistView({ sorts: sortRulesToStored(next), sort: null });
  }, [persistView]);

  // Grouped once per fetch, not per cell — every staffing cell looks its
  // event up here.
  const byEvent = useMemo(() => assignmentsByEvent(assignments ?? []), [assignments]);

  // Inline edits save one field at a time and swap the server's copy in. No
  // optimistic write: each cell shows its own saving/error state, and a
  // rejected change simply never lands.
  const updateEvent = useCallback(async (event: TournamentEvent, patch: Partial<TournamentEventInput>) => {
    const saved = await tournamentEventsApi.update(tournamentId, event.id, patch);
    setEvents((prev) => (prev ?? []).map((e) => (e.id === saved.id ? saved : e)));
  }, [tournamentId]);

  // Locked where the row is already being edited some other way: Select mode
  // (a click there toggles the box), or the panel open on it — that one is
  // the row's to add (see EventRow), so focusing a row rebuilds no columns.
  const editContext = useMemo<EventEditContext | undefined>(() => (canManageEvents ? {
    lockReason: () => {
      if (archivedReason) return archivedReason;
      if (selectMode) return "Leave Select mode to edit in the table";
      return undefined;
    },
    update: updateEvent,
    divisions: selectedTournament?.division ?? [],
    shifts: allShifts ?? [],
    roles,
    buildings,
    ensureBuilding: async (name, trackId) => {
      const building = await ensureBuildingOnTrack(tournamentId, name, trackId, buildings);
      handleBuildingSaved(building);
      return building;
    },
    confirm: setPendingConfirm,
  } : undefined), [
    canManageEvents, archivedReason, selectMode, updateEvent, selectedTournament, allShifts,
    roles, buildings, tournamentId, handleBuildingSaved,
  ]);

  const tableColumns = useMemo(
    // A saved list of [] means "no columns"; only a missing one falls back to
    // the defaults, which is why null and [] are kept apart.
    () => resolveEventColumns(columnKeys ?? DEFAULT_EVENT_COLUMNS, {
      // Live tracks only; each family narrows further (see familyTracks).
      tracks: tracks.filter((t) => !t.is_archived),
      assignmentsFor: (eventId) => byEvent.get(eventId) ?? NO_ASSIGNMENTS,
      edit: editContext,
    }),
    [columnKeys, tracks, byEvent, editContext],
  );
  // Off-default is what the Display button reports, compared after expansion
  // so a saved copy of the defaults doesn't read as a change.
  const defaultColumnKeys = useMemo(
    () => resolveEventColumns(DEFAULT_EVENT_COLUMNS, { tracks, assignmentsFor: () => NO_ASSIGNMENTS }).map((c) => c.key).join(),
    [tracks],
  );
  const displayActive = tableColumns.map((c) => c.key).join() !== defaultColumnKeys;
  const resetDisplay = useCallback(() => {
    setColumnKeys(null);
    persistView({ columns: null });
  }, [persistView]);

  const showsStaffing = tableColumns.some((c) => trackFamilyOf(c.key) === "staffing")
    || sortRules.some((rule) => rule.field === "staffing")
    || filters.staffing.size > 0;

  // Only fetched while something staffing-shaped is on (a column, the sort,
  // the filter) — a whole tournament's assignments isn't free.
  useEffect(() => {
    if (!canManageEvents || !showsStaffing) return;
    let current = true;
    assignmentsApi.list(tournamentId)
      .then((next) => { if (current) setAssignments(next); })
      .catch(() => { if (current) setAssignments([]); });
    return () => { current = false; };
  }, [tournamentId, canManageEvents, showsStaffing, refreshKey]);

  const divisionOptions = useMemo(() => {
    const opts = (selectedTournament?.division ?? []).map((d: TournamentDivision) => ({ value: d, label: `Division ${d}` }));
    return (events ?? []).some((e) => e.division === null) ? [...opts, { value: EVENT_FILTER_UNSET, label: "No division" }] : opts;
  }, [selectedTournament, events]);

  const categoryOptions = useMemo(() => eventCategoryOptions(events ?? []), [events]);
  const trackOptions = useMemo(() => eventTrackOptions(events ?? []), [events]);
  const buildingOptions = useMemo(() => eventBuildingOptions(events ?? []), [events]);
  const shiftOptions = useMemo(() => eventShiftOptions(events ?? []), [events]);

  const visibleEvents = useMemo(() => {
    if (!events) return [];
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (q && !eventName(e).toLowerCase().includes(q)) return false;
      return eventPassesFilters(e, filters, {
        assignmentsFor: (id) => byEvent.get(id) ?? NO_ASSIGNMENTS,
        showsTrack: ALL_TRACKS,
      });
    });
    return sortRows(
      filtered,
      sortRules,
      (event, field) => eventSortValue(event, field, (id) => byEvent.get(id) ?? NO_ASSIGNMENTS, ALL_TRACKS),
      eventSortTiebreak,
    );
  }, [events, search, filters, sortRules, byEvent]);

  // Steps through the table's own current filter/sort order, so switching
  // sort or narrowing a filter mid-edit still lands somewhere sensible.
  const { hasPrev, hasNext, prevId, nextId } = getPrevNext(visibleEvents, (e) => e.id);

  // Only meaningful for the Select-mode flow — the panel there only opens
  // once "Edit" is pressed in the SelectionBar, not as soon as one row is
  // checked (see massPanelOpen).
  const selectedEvents = useMemo(
    () => (events ?? []).filter((e) => selectedIds.has(e.id)),
    [events, selectedIds]
  );

  // Exact copies, tracks and shifts included. A custom event gets "(copy)" on
  // its name; a catalog event keeps its link, so the backend refuses a copy in
  // the same division (one per division) and the toast says so.
  async function duplicateSelected() {
    setDuplicating(true);
    const outcomes = await Promise.allSettled(selectedEvents.map((e) => tournamentEventsApi.create(tournamentId, {
      tournament_id: tournamentId,
      event_id: e.event_id,
      // A linked copy keeps any rename override; a custom one is marked as the copy.
      name: e.event_id ? e.name : `${e.name ?? "Event"} (copy)`,
      division: e.division,
      event_type: e.event_type,
      // Carries the copy's location and staffing needs across with it —
      // track_details is whole-set, so this is also what keeps the copy on
      // the same tracks.
      track_details: e.track_details.map(toTrackDetailInput),
      shift_ids: e.shifts.map((s) => s.id),
    })));
    const created = outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
    if (created.length > 0) setEvents((prev) => [...(prev ?? []), ...created]);
    const failure = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    if (failure) {
      const reason = failure.reason instanceof ApiError ? failure.reason.message : "Something went wrong.";
      show(`Duplicated ${created.length}, ${outcomes.length - created.length} failed: ${reason}`, "error");
    } else {
      show(`Duplicated ${created.length} event${created.length === 1 ? "" : "s"}.`);
    }
    setDuplicating(false);
  }

  // Deduped across every event — the same pending track can hold dozens.
  const eventTracks = useMemo(() => {
    const byId = new Map<number, TournamentTrack>();
    for (const event of events ?? []) for (const track of event.tracks) byId.set(track.id, track);
    return [...byId.values()];
  }, [events]);

  const { setPanel, clearPanel } = useSetLayoutPanel();

  // The editors don't render here — they're pushed into the layout shell's
  // docked slot so the panel is a *sibling* of <main> and shrinks it, leaving
  // the table clickable. Re-runs whenever anything the panel is built from
  // changes, so the element never closes over stale props.
  useEffect(() => {
    // Same reason as the fetch above — an effect on this page now runs even
    // when the render below is the no-access card, and that page has no
    // panel to dock.
    if (!canManageEvents) return;
    const catalog = {
      canonicalEvents, allShifts, tracks, buildings, roles,
      onShiftCreated: handleShiftCreated, onBuildingSaved: handleBuildingSaved,
    };
    if (creatingNew) {
      setPanel(
        <EventPanel
          key={`new-${createKey}`}
          tournamentId={tournamentId}
          event={null}
          {...catalog}
          locked={isArchived}
          onClose={clearCreatingNew}
          onDirtyChange={setPanelDirty}
          onSaved={(saved) => setEvents((prev) => {
            const list = prev ?? [];
            const exists = list.some((e) => e.id === saved.id);
            return exists ? list.map((e) => (e.id === saved.id ? saved : e)) : [...list, saved];
          })}
          onDeleted={(id) => setEvents((prev) => (prev ?? []).filter((e) => e.id !== id))}
        />,
        EVENT_PANEL_WIDTH,
      );
      return;
    }

    if (focusedEventId !== null) {
      // Not loaded is not the same as not there. The id can arrive from the
      // URL before the first fetch lands, and clearing on a null list would
      // drop the panel a refresh was meant to reopen — along with the param
      // naming it.
      if (events === null) return;
      const event = events.find((e) => e.id === focusedEventId);
      if (!event) { clearFocus(); return; }
      // Keyed on the event id so clicking a different row while one is
      // already focused remounts the panel — its draft/current state is
      // seeded from props via useState, which wouldn't otherwise re-read.
      setPanel(
        <EventPanel
          key={event.id}
          tournamentId={tournamentId}
          event={event}
          {...catalog}
          locked={isArchived}
          onClose={clearFocus}
          onDirtyChange={setPanelDirty}
          onSaved={(saved) => setEvents((prev) => (prev ?? []).map((e) => (e.id === saved.id ? saved : e)))}
          onDeleted={(id) => setEvents((prev) => (prev ?? []).filter((e) => e.id !== id))}
          onPrev={() => prevId !== null && focusEvent(prevId)}
          onNext={() => nextId !== null && focusEvent(nextId)}
          hasPrev={hasPrev}
          hasNext={hasNext}
        />,
        EVENT_PANEL_WIDTH,
      );
      return;
    }

    if (massPanelOpen && selectedEvents.length === 1) {
      setPanel(
        <EventPanel
          key={selectedEvents[0].id}
          tournamentId={tournamentId}
          event={selectedEvents[0]}
          {...catalog}
          locked={isArchived}
          onClose={clearSelection}
          onDirtyChange={setPanelDirty}
          onSaved={(saved) => setEvents((prev) => (prev ?? []).map((e) => (e.id === saved.id ? saved : e)))}
          onDeleted={(id) => setEvents((prev) => (prev ?? []).filter((e) => e.id !== id))}
        />,
        EVENT_PANEL_WIDTH,
      );
      return;
    }

    if (massPanelOpen && selectedEvents.length > 1) {
      setPanel(
        <MassEventEditor
          tournamentId={tournamentId}
          events={selectedEvents}
          onClose={clearSelection}
          onDirtyChange={setPanelDirty}
          onSaved={(saved) => setEvents((prev) => (prev ?? []).map((e) => (e.id === saved.id ? saved : e)))}
        />,
        MASS_EVENT_EDITOR_WIDTH,
      );
      return;
    }

    clearPanel();
  }, [
    canManageEvents,
    creatingNew, createKey, focusedEventId, events, massPanelOpen, selectedEvents, tournamentId, isArchived,
    canonicalEvents, allShifts, tracks, buildings, roles, handleShiftCreated, handleBuildingSaved,
    prevId, nextId, hasPrev, hasNext, focusEvent, setPanelDirty,
    clearFocus, clearCreatingNew, clearSelection, setPanel, clearPanel,
  ]);

  // Unmount only (e.g. navigating away from the events page) — clearing in the
  // effect above's cleanup instead would tear the panel down on every re-run.
  useEffect(() => () => clearPanel(), [clearPanel]);

  // Every early return below sits after every hook above, which is the whole
  // constraint the flattening had to respect: a gate that returned before
  // them would change the hook order between renders.
  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageEvents) {
    return (
      <div>
        <CollapsibleHeader heading="Events" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage events permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (events === null || !viewReady) {
    return (
      <div>
        <CollapsibleHeader heading="Events" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const isFiltered = search.trim() !== "" || isEventsFilterActive(filters);


  // A header that sorts its column. The default chain isn't shown as a
  // header state — it's the absence of a choice, and clicking replaces it.
  const headerSortRules = sameSortRules(sortRules, DEFAULT_TABLE_SORT) ? [] : sortRules;
  const sortableHeader = (field: EventSortField, label: string, align: "start" | "center") => {
    const index = headerSortRules.findIndex((rule) => rule.field === field);
    return (
      <SortableHeader
        label={label}
        align={align}
        rule={index < 0 ? null : { direction: headerSortRules[index].direction, position: index + 1 }}
        showPosition={headerSortRules.length > 1}
        onClick={() => applySort(cycleSortRule(sortRules, field, DEFAULT_TABLE_SORT))}
      />
    );
  };

  return (
    <div>
      <CollapsibleHeader heading="Events" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {/* Only the tracks these events actually hold — a pending-delete track
          with nothing on this page isn't this page's problem. */}
      <PendingTrackBanner tracks={eventTracks} subject="events" />

      {events.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          {canManageEvents && !isArchived && !hasDivisions ? (
            <EmptyState
              icon={<IconWarning size={28} />}
              title="No divisions assigned"
              description="This tournament has no divisions assigned yet. Assign at least one before loading default events."
              action={
                <Button type="button" variant="primary" size="sm" onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/settings/general`)}>
                  Go to settings
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<IconEvents size={28} />}
              title="No events yet"
              description="Load this tournament's default events, or add them one at a time."
              action={
                canManageEvents ? (
                  <div style={{ display: "flex", gap: "10px" }}>
                    <Button
                      type="button" variant="primary" size="sm" onClick={() => setShowLoadModal(true)}
                      disabled={isArchived} title={archivedReason}
                    >
                      Load default events
                    </Button>
                    <Button
                      type="button" variant="secondary" size="sm" onClick={handleAddEvent}
                      disabled={isArchived} title={archivedReason}
                    >
                      <IconPlus size={12} /> Add event
                    </Button>
                  </div>
                ) : undefined
              }
            />
          )}
        </Card>
      ) : (
        <>
          <div ref={toolbarRef} style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap", flex: "1 1 auto", minWidth: 0 }}>
              {/* Grows into whatever the toolbar leaves over, and is the first
                  thing to give that room back: a small basis with grow means
                  the search narrows before anything else has to wrap, and
                  the other controls stay their natural size. */}
              <div style={{ flex: "1 1 220px", minWidth: "180px", maxWidth: "460px" }}>
                <Input
                  // No visible label — the placeholder and icon say it; aria-label keeps it named for screen readers.
                  aria-label="Search events"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClear={() => setSearch("")}
                  placeholder="Search event name"
                  icon={<IconSearch size={14} />}
                  font="sans"
                  size="md"
                  variant="secondary"
                  fullWidth
                />
              </div>
              <FilterButton
                iconOnly={compactToolbar}
                active={isEventsFilterActive(filters)}
                onOpen={() => setShowFilterModal(true)}
                onClear={() => applyFilters(emptyFilterState(EVENTS_FILTER_KEYS))}
              />
              <DisplayButton
                iconOnly={compactToolbar}
                active={displayActive}
                onOpen={() => setShowColumnsModal(true)}
                onReset={resetDisplay}
              />
              <SortButton
                iconOnly={compactToolbar}
                active={!sameSortRules(sortRules, DEFAULT_TABLE_SORT)}
                onOpen={() => setShowSortModal(true)}
                onReset={() => applySort(DEFAULT_TABLE_SORT)}
              />
              {canManageEvents && (
                <Button
                  type="button" variant={selectMode ? "primary" : "secondary"} size="md"
                  onClick={toggleSelectMode}
                  disabled={panelDirty || isArchived}
                  title={archivedReason ?? (panelDirty ? "Save or discard your changes first" : undefined)}
                >
                  Select
                </Button>
              )}
            </div>

            {canManageEvents && (
              <Button
                type="button" variant="primary" size="md" iconOnly={compactToolbar}
                onClick={handleAddEvent}
                disabled={panelDirty || isArchived}
                title={archivedReason ?? (panelDirty ? "Save or discard your changes first" : compactToolbar ? "Add event" : undefined)}
              >
                <IconPlus size={14} />{!compactToolbar && " Add event"}
              </Button>
            )}
          </div>

          <Card radius="lg" className={table.scroll} style={{ padding: "8px 12px" }}>
            {/* One grid owns the tracks; header and rows are subgrids of it,
                so toggling Select mode resolves the template once rather than
                once per row (which is what this table did before). */}
            <div
              className={`${table.table} ${table.animatedTracks}`}
              style={{ gridTemplateColumns: eventGridColumns(selectMode, tableColumns) }}
              // Arrow keys move between cells (see gridNav); Tab still walks the same stops.
              onKeyDown={handleGridArrows}
            >
            <div className={table.header}>
              <span
                className={`${table.collapsible} ${selectMode ? "" : table.collapsed}`}
                style={{ display: "flex", justifyContent: "center" }}
                title={panelDirty ? "Save or discard your changes first" : undefined}
              >
                <Checkbox
                  checked={visibleEvents.length > 0 && visibleEvents.every((e) => selectedIds.has(e.id))}
                  locked={panelDirty}
                  onChange={(checked) => toggleSelectAll(visibleEvents.map((e) => e.id), checked)}
                />
              </span>
              {sortableHeader("name", `Events — ${isFiltered ? `${visibleEvents.length} of ${events.length}` : events.length}`, "start")}
              {tableColumns.map((column) => column.sortField ? (
                <span
                  key={column.key}
                  // Same alignment as the column's cells, so the header sits over them.
                  style={{ display: "flex", minWidth: 0, justifyContent: column.align === "start" ? "flex-start" : "center" }}
                >
                  {sortableHeader(column.sortField, column.label, column.align === "start" ? "start" : "center")}
                </span>
              ) : (
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
              <span />
            </div>

            {visibleEvents.length === 0 ? (
              <EmptyState title="No matching events" description="Try adjusting your search or filters." />
            ) : (
              visibleEvents.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  columns={tableColumns}
                  canDelete={canManageEvents}
                  deleteLockedReason={archivedReason}
                  onFocus={focusEvent}
                  onDelete={confirmDelete}
                  selectMode={selectMode}
                  selected={selectedIds.has(e.id)}
                  selectionLocked={panelDirty}
                  onToggleSelect={toggleSelected}
                  focused={focusedEventId === e.id}
                  edit={editContext}
                />
              ))
            )}
            </div>
          </Card>
        </>
      )}

      {showSortModal && (
        <SortModal
          title="Sort events"
          fields={EVENT_SORT_OPTIONS}
          rules={sortRules}
          defaults={DEFAULT_TABLE_SORT}
          tiebreakLabel={EVENT_SORT_TIEBREAK}
          onApply={(next) => applySort(next as SortRule<EventSortField>[])}
          onClose={() => setShowSortModal(false)}
        />
      )}

      {showFilterModal && (
        <EventsFilterModal
          divisionOptions={divisionOptions}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={categoryOptions}
          trackOptions={trackOptions}
          buildingOptions={buildingOptions}
          shiftOptions={shiftOptions}
          filters={filters}
          onApply={applyFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}

      {showColumnsModal && (
        <EventsColumnsModal
          tournamentId={tournamentId}
          onSaved={() => setDisplayConfigVersion((v) => v + 1)}
          onClose={() => setShowColumnsModal(false)}
        />
      )}

      {showLoadModal && (
        <LoadDefaultEventsModal
          tournamentId={tournamentId}
          divisions={divisions}
          existingEvents={events}
          onClose={() => setShowLoadModal(false)}
          onLoaded={(created) => setEvents((prev) => [...(prev ?? []), ...created])}
        />
      )}

      {/* Stays up through the whole "checking boxes" phase — the panel only
          opens once Edit is pressed here, not as soon as one row is checked. */}
      <SelectionBar
        visible={selectMode && !massPanelOpen}
        count={selectedIds.size}
        onEdit={openMassPanel}
        onCancel={toggleSelectMode}
        actions={
          <>
            <Button
              type="button" variant="secondary" size="sm" iconOnly title="Duplicate selected"
              disabled={selectedIds.size === 0} loading={duplicating} onClick={duplicateSelected}
            >
              <IconCopy size={13} />
            </Button>
            <Button
              type="button" variant="secondary" size="sm" iconOnly title="Delete selected"
              disabled={selectedIds.size === 0} onClick={() => setDeleteTargets(selectedEvents)}
            >
              <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
            </Button>
          </>
        }
      />

      {pendingConfirm && (
        <ConfirmModal
          title={pendingConfirm.title}
          description={pendingConfirm.description}
          confirmLabel={pendingConfirm.confirmLabel}
          variant="danger"
          onConfirm={pendingConfirm.onConfirm}
          onClose={() => setPendingConfirm(null)}
        />
      )}

      {deleteTargets && (
        <DeleteEventModal
          tournamentId={tournamentId}
          events={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onDeleted={(ids) => {
            const gone = new Set(ids);
            setEvents((prev) => (prev ?? []).filter((e) => !gone.has(e.id)));
            // Otherwise a deleted-but-still-selected/focused row would keep
            // a panel open against a row that no longer exists.
            forgetItem(ids);
          }}
        />
      )}
    </div>
  );
}

// Memoised so a page re-render that changes nothing here — a search keystroke,
// a panel opening — doesn't rebuild every row's cells. Keep props identity-stable.
const EventRow = memo(function EventRow({
  event, columns, canDelete, deleteLockedReason, onFocus, onDelete, selectMode, selected, selectionLocked, onToggleSelect, focused, edit,
}: {
  event: TournamentEvent;
  /** The viewer's configured columns, between Name and Actions. */
  columns: EventColumn[];
  canDelete: boolean;
  /** Shown and disabled rather than hidden — archiving locks, it doesn't hide. */
  deleteLockedReason?: string;
  /** These three take the row's event (or its id), so one callback serves every row. */
  onFocus: (eventId: number) => void;
  onDelete: (event: TournamentEvent) => void;
  selectMode: boolean;
  selected: boolean;
  /** Open panel has unsaved changes — switching focus/selection is frozen until it resolves. */
  selectionLocked: boolean;
  onToggleSelect: (eventId: number) => void;
  /** This row is the one currently shown in the single-edit panel. */
  focused: boolean;
  /** Given, the name edits in place (custom events only). */
  edit?: EventEditContext;
}) {
  // A click toggles the box in Select mode and opens (or switches) the panel
  // otherwise. Editable cells keep their own clicks (CellGuard), so only a
  // click outside them reaches the row. Frozen while the panel is dirty.
  // This event is one of the references keeping a pending-delete track
  // alive — flagged here so the ones to repoint are findable in the table.
  const isPending = event.tracks.some((t) => t.is_archived);
  const handleRowClick = selectionLocked
    ? undefined
    : selectMode ? () => onToggleSelect(event.id) : () => onFocus(event.id);
  const highlighted = selectMode ? selected : focused;
  // The panel's draft and a cell save would overwrite each other.
  const lockReason = edit?.lockReason(event) ?? (focused ? "Being edited in the panel" : undefined);
  const lockedTitle = selectionLocked ? "Save or discard your changes first" : undefined;

  // Locked keeps the same EditableText, just inert, so the name doesn't shift
  // when its row opens in the panel.
  const nameText = edit && (
    <EditableText
      value={eventName(event)}
      // On a catalog-linked event the name is an override: typing the
      // catalog's own name back, or clearing it, drops the override.
      onSave={(name) => edit.update(event, {
        name: event.event && (!name || name === event.event.name) ? null : name,
      })}
      allowEmpty={!!event.event}
      errorToast
      locked={!!lockReason}
      textStyle={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 }}
      title={lockReason ?? (event.event ? "Click to rename for this tournament — clear to use the catalog name" : "Click to rename")}
    />
  );
  const nameCell = !nameText
    ? eventName(event)
    : lockReason
      ? <LockedCell align="start">{nameText}</LockedCell>
      : <CellGuard align="start">{nameText}</CellGuard>;

  return (
    <div
      className={table.row}
      data-nav-row
      data-active={highlighted ? "true" : undefined}
      data-pending={isPending ? "true" : undefined}
      onClick={handleRowClick}
      {...rowActivation(handleRowClick)}
      title={lockedTitle}
      style={{ cursor: selectionLocked ? "not-allowed" : "pointer" }}
    >
      <span
        className={`${table.collapsible} ${selectMode ? "" : table.collapsed}`}
        style={{ display: "flex", justifyContent: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} locked={selectionLocked} onChange={() => onToggleSelect(event.id)} />
      </span>
      <span data-nav-col="name" style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {nameCell}
      </span>
      {/* Each cell knows how to render itself (see eventColumns) — the row
          only places them, so adding a column is one entry there. */}
      {columns.map((column) => (
        <span key={column.key} data-nav-col={column.key} style={{ minWidth: 0 }}>{column.render(event, lockReason)}</span>
      ))}
      <div data-nav-col="actions" style={{ display: "flex", justifyContent: "center", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
        {canDelete && (
          <Button
            type="button" variant="secondary" size="sm" iconOnly onClick={() => onDelete(event)}
            disabled={!!deleteLockedReason} title={deleteLockedReason ?? "Delete event"}
          >
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        )}
      </div>
    </div>
  );
});
