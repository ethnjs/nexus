"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  tournamentEventsApi, displayConfigApi, ApiError, DisplayConfig, DisplayConfigSurface,
  TournamentEvent, TournamentDivision, TournamentTrack,
} from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PendingTrackBanner } from "@/components/tournament/PendingTrackBanner";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Checkbox } from "@/components/ui/Checkbox";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { IconSearch, IconArrowDown, IconEvents, IconWarning, IconEdit, IconPlus, IconTrash, IconFilter, IconX, IconEye, IconLock } from "@/components/ui/Icons";
import { LoadDefaultEventsModal } from "@/components/tournament/events/LoadDefaultEventsModal";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { useInitialPanelId, usePanelUrlSync } from "@/lib/usePanelUrl";
import { EventPanel, EVENT_PANEL_WIDTH } from "@/components/tournament/events/EventPanel";
import { DeleteEventModal } from "@/components/tournament/events/DeleteEventModal";
import {
  EventsFilterModal, EventsFilterState, isEventsFilterActive, EVENTS_FILTER_KEYS,
  EVENT_FILTER_UNSET, eventCategoryKey, eventCategoryOptions,
  eventsFilterFromStored, eventsFilterToStored, EVENT_TYPE_OPTIONS,
} from "@/components/tournament/events/EventsFilterModal";
import { emptyFilterState, filterAllows } from "@/components/ui/FilterModal";
import { EventsColumnsModal } from "@/components/tournament/events/EventsColumnsModal";
import {
  DEFAULT_EVENT_COLUMNS, EVENT_COLUMN_WIDTHS, EventColumn, resolveEventColumns,
} from "@/components/tournament/events/eventColumns";
import { EVENTS_TABLE } from "@/lib/displayConfigSurfaces";
import { MassEventEditor, MASS_EVENT_EDITOR_WIDTH } from "@/components/tournament/events/MassEventEditor";
import { eventFirstDay, eventName } from "@/lib/eventDisplay";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";

// Always present as a grid track (never conditionally added/removed) so its
// width can transition between 0 and full instead of popping in — animating
// grid-template-columns only works when the track count stays constant.
const SELECT_COLUMN_WIDTH = "28px";

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

type SortField = "name" | "division" | "day";
type SortDir = "asc" | "desc";

// Sentinel for the null case of a nullable field (division/category) so it
// can sit in the same filter Set as real values.

const SORT_FIELD_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "division", label: "Division" },
  { value: "day", label: "Day" },
];

function sortValue(e: TournamentEvent, field: SortField): string | number {
  switch (field) {
    case "name": return eventName(e).toLowerCase();
    case "division": return e.division ?? "";
    // An event has no time of its own — its schedule is its shifts, so
    // the first day it runs is what there is to sort by.
    case "day": return eventFirstDay(e);
  }
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
  const { selectedTournament, isArchived } = useTournament();
  const divisions = selectedTournament?.division ?? [];
  const hasDivisions = divisions.length > 0;

  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [showLoadModal, setShowLoadModal] = useState(false);
  // Creating a new event is the one panel that isn't driven by selection —
  // there's no row to select yet.
  const [creatingNew, setCreatingNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TournamentEvent | null>(null);
  // Bumped on a Display save so the effect below re-reads the just-saved
  // columns — it otherwise only runs on a tournament change.
  const [displayConfigVersion, setDisplayConfigVersion] = useState(0);

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
  const [sortField, setSortField] = useState<SortField>("day");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  // Blocked while dirty and clears whatever else was open — otherwise this
  // would silently replace a focused event or an in-progress selection with a
  // blank "new event" draft with no warning.
  function handleAddEvent() {
    startExternalFlow(() => setCreatingNew(true));
  }

  async function loadEvents() {
    try {
      const next = await tournamentEventsApi.list(tournamentId);
      setEvents(next);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load events.");
    }
  }

  // Gated on the permission, and re-run when it lands: the table used to be a
  // child that only mounted once the check had passed, so unmounted meant
  // unfetched. Inlined, this effect runs on the first render too — while
  // membership is still loading and the answer is a provisional false.
  useEffect(() => {
    if (!canManageEvents) return;
    loadEvents();
  }, [tournamentId, canManageEvents]);

  // This viewer's saved view of the table — columns, filters and sort. The
  // catalog isn't needed here (unlike the roster's): every events column is a
  // fixed key with a label the client already knows, so nothing has to be
  // looked up before a column can render.
  useEffect(() => {
    // Nothing to read without the permission the config route wants — the
    // table still renders, just on its defaults, so this can't be left
    // waiting on a request it is never going to make.
    if (!canManageEvents) { setViewReady(true); return; }
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
          if (surface?.sort && SORT_FIELD_OPTIONS.some((o) => o.value === surface.sort!.field)) {
            setSortField(surface.sort.field as SortField);
            setSortDir(surface.sort.direction === "asc" ? "asc" : "desc");
          }
          return true;
        });
      });
    return () => { current = false; };
  }, [tournamentId, canManageEvents, displayConfigVersion]);

  // Write-back for the view state this tab owns (filters, sort). Re-reads
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
        [EVENTS_TABLE]: { ...{ hidden: [] }, ...fresh[EVENTS_TABLE], ...patch },
      }))
      .catch(() => {});
  }, [tournamentId]);

  const applyFilters = useCallback((next: EventsFilterState) => {
    setFilters(next);
    persistView({ filters: eventsFilterToStored(next) });
  }, [persistView]);

  const applySort = useCallback((field: SortField, direction: SortDir) => {
    setSortField(field);
    setSortDir(direction);
    persistView({ sort: { field, direction } });
  }, [persistView]);

  const tableColumns = useMemo(
    // A saved list of [] means "no columns"; only a missing one falls back to
    // the defaults, which is why null and [] are kept apart.
    () => resolveEventColumns(columnKeys ?? DEFAULT_EVENT_COLUMNS),
    [columnKeys],
  );

  const divisionOptions = useMemo(() => {
    const opts = (selectedTournament?.division ?? []).map((d: TournamentDivision) => ({ value: d, label: `Division ${d}` }));
    return (events ?? []).some((e) => e.division === null) ? [...opts, { value: EVENT_FILTER_UNSET, label: "No division" }] : opts;
  }, [selectedTournament, events]);

  const categoryOptions = useMemo(() => eventCategoryOptions(events ?? []), [events]);

  const visibleEvents = useMemo(() => {
    if (!events) return [];
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (q && !eventName(e).toLowerCase().includes(q)) return false;
      if (!filterAllows(filters.division, e.division ?? EVENT_FILTER_UNSET)) return false;
      if (!filterAllows(filters.type, e.event_type)) return false;
      if (!filterAllows(filters.category, eventCategoryKey(e))) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [events, search, filters, sortField, sortDir]);

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
    if (creatingNew) {
      setPanel(
        <EventPanel
          tournamentId={tournamentId}
          event={null}
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
    creatingNew, focusedEventId, events, massPanelOpen, selectedEvents, tournamentId, isArchived,
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
        <PageHeader heading="Events" />
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
        <PageHeader heading="Events" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const isFiltered = search.trim() !== "" || isEventsFilterActive(filters);

  return (
    <div>
      <PageHeader heading="Events" />

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
                canManageEvents && !isArchived ? (
                  <div style={{ display: "flex", gap: "10px" }}>
                    <Button type="button" variant="primary" size="sm" onClick={() => setShowLoadModal(true)}>
                      Load default events
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={handleAddEvent}>
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
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ width: "300px" }}>
                <Input
                  label="Search"
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
              <Button
                type="button" variant="secondary" size="md"
                onClick={() => setShowFilterModal(true)}
              >
                <IconFilter size={16} /> Filter
              </Button>
              {isEventsFilterActive(filters) && (
                <Button
                  type="button" variant="ghost" size="md"
                  onClick={() => applyFilters(emptyFilterState(EVENTS_FILTER_KEYS))}
                >
                  <IconX size={16} /> Clear filters
                </Button>
              )}
              <Button
                type="button" variant="secondary" size="md"
                onClick={() => setShowColumnsModal(true)}
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
              {canManageEvents && !isArchived && (
                <Button
                  type="button" variant={selectMode ? "primary" : "secondary"} size="md"
                  onClick={toggleSelectMode}
                  disabled={panelDirty}
                  title={panelDirty ? "Save or discard your changes first" : undefined}
                >
                  Select
                </Button>
              )}
            </div>

            {canManageEvents && !isArchived && (
              <Button
                type="button" variant="primary" size="md"
                onClick={handleAddEvent}
                disabled={panelDirty}
                title={panelDirty ? "Save or discard your changes first" : undefined}
              >
                <IconPlus size={14} /> Add event
              </Button>
            )}
          </div>

          <Card radius="lg" style={{ padding: "8px 12px" }}>
            <div style={{
              display: "grid", gridTemplateColumns: eventGridColumns(selectMode, tableColumns), gap: "10px",
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
                title={panelDirty ? "Save or discard your changes first" : undefined}
              >
                <Checkbox
                  checked={visibleEvents.length > 0 && visibleEvents.every((e) => selectedIds.has(e.id))}
                  locked={panelDirty}
                  onChange={(checked) => toggleSelectAll(visibleEvents.map((e) => e.id), checked)}
                />
              </span>
              <span>Events — {isFiltered ? `${visibleEvents.length} of ${events.length}` : events.length}</span>
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
              <span style={{ textAlign: "center" }}>Actions</span>
            </div>

            {visibleEvents.length === 0 ? (
              <EmptyState title="No matching events" description="Try adjusting your search or filters." />
            ) : (
              visibleEvents.map((e, i) => (
                <EventRow
                  key={e.id}
                  event={e}
                  columns={tableColumns}
                  isLast={i === visibleEvents.length - 1}
                  canDelete={canManageEvents && !isArchived}
                  onFocus={() => focusEvent(e.id)}
                  onDelete={() => setDeleteTarget(e)}
                  selectMode={selectMode}
                  selected={selectedIds.has(e.id)}
                  selectionLocked={panelDirty}
                  onToggleSelect={() => toggleSelected(e.id)}
                  focusActive={focusedEventId !== null}
                  focused={focusedEventId === e.id}
                />
              ))
            )}
          </Card>
        </>
      )}

      {showFilterModal && (
        <EventsFilterModal
          divisionOptions={divisionOptions}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={categoryOptions}
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
      />

      {deleteTarget && (
        <DeleteEventModal
          tournamentId={tournamentId}
          eventId={deleteTarget.id}
          eventName={eventName(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setEvents((prev) => (prev ?? []).filter((e) => e.id !== deleteTarget.id));
            // Otherwise a deleted-but-still-selected/focused row would keep
            // a panel open against a row that no longer exists.
            forgetItem(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function EventRow({
  event, columns, isLast, canDelete, onFocus, onDelete, selectMode, selected, selectionLocked, onToggleSelect, focusActive, focused,
}: {
  event: TournamentEvent;
  /** The viewer's configured columns, between Name and Actions. */
  columns: EventColumn[];
  isLast: boolean;
  canDelete: boolean;
  onFocus: () => void;
  onDelete: () => void;
  selectMode: boolean;
  selected: boolean;
  /** Open panel has unsaved changes — switching focus/selection is frozen until it resolves. */
  selectionLocked: boolean;
  onToggleSelect: () => void;
  /** A single-edit panel is open (for some row, not necessarily this one) — rows become click-to-switch instead of inert. */
  focusActive: boolean;
  /** This row is the one currently shown in the single-edit panel. */
  focused: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  // Two different reasons a row might be clickable: toggling a checkbox in
  // Select mode, or switching which row the single-edit panel shows. Never
  // both at once — the two flows are mutually exclusive.
  // This event is one of the references keeping a pending-delete track
  // alive — flagged here so the ones to repoint are findable in the table.
  const isPending = event.tracks.some((t) => t.is_archived);
  const clickable = (selectMode || focusActive) && !selectionLocked;
  const handleRowClick = selectMode ? onToggleSelect : onFocus;
  const highlighted = selectMode ? selected : focused;
  const lockedTitle = selectionLocked ? "Save or discard your changes first" : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={clickable ? handleRowClick : undefined}
      title={(selectMode || focusActive) ? lockedTitle : undefined}
      style={{
        display: "grid", gridTemplateColumns: eventGridColumns(selectMode, columns), alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: isPending
          ? (highlighted || hovered ? "var(--color-warning-subtle-hover)" : "var(--color-warning-subtle)")
          : (highlighted || hovered ? "var(--color-bg)" : "transparent"),
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
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {eventName(event)}
      </span>
      {/* Each cell knows how to render itself (see eventColumns) — the row
          only places them, so adding a column is one entry there. */}
      {columns.map((column) => (
        <span key={column.key} style={{ minWidth: 0 }}>{column.render(event)}</span>
      ))}
      <div style={{ display: "flex", justifyContent: "center", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
        <Button type="button" variant="secondary" size="sm" iconOnly disabled={selectionLocked} title={lockedTitle ?? "Edit"} onClick={onFocus}>
          <IconEdit size={13} />
        </Button>
        {canDelete && (
          <Button type="button" variant="secondary" size="sm" iconOnly title="Delete event" onClick={onDelete}>
            <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
          </Button>
        )}
      </div>
    </div>
  );
}
