"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { tournamentEventsApi, tournamentTracksApi, ApiError, TournamentEvent, TournamentDivision } from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Checkbox } from "@/components/ui/Checkbox";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { IconSearch, IconArrowDown, IconEvents, IconWarning, IconEdit, IconPlus, IconTrash, IconFilter, IconX } from "@/components/ui/Icons";
import { LoadDefaultEventsModal } from "@/components/tournament/events/LoadDefaultEventsModal";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { usePanelSelection } from "@/lib/usePanelSelection";
import { EventPanel, EVENT_PANEL_WIDTH } from "@/components/tournament/events/EventPanel";
import { DeleteEventModal } from "@/components/tournament/events/DeleteEventModal";
import { EventsFilterModal, isEventsFilterActive, EVENTS_FILTER_KEYS } from "@/components/tournament/events/EventsFilterModal";
import { emptyFilterState } from "@/components/ui/FilterModal";
import { usePersistedFilter } from "@/lib/usePersistedFilter";
import { useAuth } from "@/lib/useAuth";
import { MassEventEditor, MASS_EVENT_EDITOR_WIDTH } from "@/components/tournament/events/MassEventEditor";
import { eventName } from "@/lib/eventDisplay";

// Name doesn't need much room (event names are short); Start/End are 50%
// wider than before so a full date+time doesn't get clipped.
const EVENT_ROW_COLUMNS = "1.3fr 90px 100px 1.1fr 200px 80px 70px";
// Always present as a grid track (never conditionally added/removed) so its
// width can transition between 0 and full instead of popping in — animating
// grid-template-columns only works when the track count stays constant.
const SELECT_COLUMN_WIDTH = "28px";
function eventColumns(selectMode: boolean) {
  return `${selectMode ? SELECT_COLUMN_WIDTH : "0px"} ${EVENT_ROW_COLUMNS}`;
}

const DIVISION_BADGE_VARIANT: Record<string, "divisionA" | "divisionB" | "divisionC"> = {
  A: "divisionA",
  B: "divisionB",
  C: "divisionC",
};

type SortField = "name" | "division" | "day";
type SortDir = "asc" | "desc";

// Sentinel for the null case of a nullable field (division/category) so it
// can sit in the same filter Set as real values.
const UNSET = "__unset__";

const TYPE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "trial", label: "Trial" },
];

const SORT_FIELD_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "division", label: "Division" },
  { value: "day", label: "Day" },
];

function categoryKey(e: TournamentEvent): string {
  return e.event?.category.name ?? UNSET;
}

function sortValue(e: TournamentEvent, field: SortField): string | number {
  switch (field) {
    case "name": return eventName(e).toLowerCase();
    case "division": return e.division ?? "";
    // An event has no time of its own — its schedule is its shifts, so
    // the first day it runs is what there is to sort by.
    case "day": return e.days[0] ?? "";
  }
}

interface EventsTabProps {
  tournamentId: number;
  canManageEvents: boolean;
}

export function EventsTab({ tournamentId, canManageEvents }: EventsTabProps) {
  const router = useRouter();
  const { user } = useAuth();
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
  // Live tracks, for badging each row. Cosmetic ones included — an event on
  // Test Writing is exactly the case the event/track bridge exists for.
  const [trackNames, setTrackNames] = useState<Map<number, string>>(new Map());

  const [search, setSearch] = useState("");
  // Committed filters only — the modal keeps its own draft until Apply.
  const [filters, applyFilters] = usePersistedFilter("events", user?.id, tournamentId, EVENTS_FILTER_KEYS);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [sortField, setSortField] = useState<SortField>("day");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // The two mutually-exclusive panel flows (single-focus vs. Select mode) and
  // the dirty gate that freezes both — shared with the Members page.
  // onClearExternal drops a still-blank "new event" draft when either flow
  // takes the panel over; it never needs to clear panelDirty, since both of
  // those transitions are already blocked while dirty.
  const {
    focusedId: focusedEventId, selectMode, selectedIds, massPanelOpen, panelDirty,
    setPanelDirty, focusItem: focusEvent, toggleSelectMode, toggleSelected, toggleSelectAll,
    openMassPanel, clearFocus, clearSelection, forgetItem, startExternalFlow, getPrevNext,
  } = usePanelSelection({ onClearExternal: () => setCreatingNew(false) });

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

  useEffect(() => {
    loadEvents();
    tournamentTracksApi.list(tournamentId, { public: true })
      .then((tracks) => setTrackNames(new Map(tracks.map((t) => [t.id, t.name]))))
      .catch(() => {});
  }, [tournamentId]);

  const divisionOptions = useMemo(() => {
    const opts = (selectedTournament?.division ?? []).map((d: TournamentDivision) => ({ value: d, label: `Division ${d}` }));
    return (events ?? []).some((e) => e.division === null) ? [...opts, { value: UNSET, label: "No division" }] : opts;
  }, [selectedTournament, events]);

  const categoryOptions = useMemo(() => {
    const names = new Set((events ?? []).filter((e) => e.event).map((e) => e.event!.category.name));
    const opts = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
    return (events ?? []).some((e) => !e.event) ? [...opts, { value: UNSET, label: "No category" }] : opts;
  }, [events]);

  const visibleEvents = useMemo(() => {
    if (!events) return [];
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (q && !eventName(e).toLowerCase().includes(q)) return false;
      if (filters.division.has(e.division ?? UNSET)) return false;
      if (filters.type.has(e.event_type)) return false;
      if (filters.category.has(categoryKey(e))) return false;
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

  const { setPanel, clearPanel } = useSetLayoutPanel();

  // The editors don't render here — they're pushed into the layout shell's
  // docked slot so the panel is a *sibling* of <main> and shrinks it, leaving
  // the table clickable. Re-runs whenever anything the panel is built from
  // changes, so the element never closes over stale props.
  useEffect(() => {
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
      const event = (events ?? []).find((e) => e.id === focusedEventId);
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
    creatingNew, focusedEventId, events, massPanelOpen, selectedEvents, tournamentId, isArchived,
    prevId, nextId, hasPrev, hasNext, focusEvent, setPanelDirty,
    clearFocus, clearCreatingNew, clearSelection, setPanel, clearPanel,
  ]);

  // Unmount only (e.g. switching away from the Events tab) — clearing in the
  // effect above's cleanup instead would tear the panel down on every re-run.
  useEffect(() => () => clearPanel(), [clearPanel]);

  if (events === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const isFiltered = search.trim() !== "" || isEventsFilterActive(filters);

  return (
    <div>
      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

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
              display: "grid", gridTemplateColumns: eventColumns(selectMode), gap: "10px",
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
              <span style={{ textAlign: "center" }}>Division</span>
              <span style={{ textAlign: "center" }}>Type</span>
              <span>Category</span>
              <span>Tracks</span>
              <span style={{ textAlign: "center" }}>Shifts</span>
              <span style={{ textAlign: "center" }}>Actions</span>
            </div>

            {visibleEvents.length === 0 ? (
              <EmptyState title="No matching events" description="Try adjusting your search or filters." />
            ) : (
              visibleEvents.map((e, i) => (
                <EventRow
                  key={e.id}
                  event={e}
                  trackNames={trackNames}
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
          typeOptions={TYPE_OPTIONS}
          categoryOptions={categoryOptions}
          filters={filters}
          onApply={applyFilters}
          onClose={() => setShowFilterModal(false)}
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
  event, trackNames, isLast, canDelete, onFocus, onDelete, selectMode, selected, selectionLocked, onToggleSelect, focusActive, focused,
}: {
  event: TournamentEvent;
  /** Track id -> name, so a row can badge its tracks without its own fetch. */
  trackNames: Map<number, string>;
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
        display: "grid", gridTemplateColumns: eventColumns(selectMode), alignItems: "center",
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
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {eventName(event)}
      </span>
      <span style={{ display: "flex", justifyContent: "center" }}>
        {event.division ? (
          <Badge variant={DIVISION_BADGE_VARIANT[event.division]}>{event.division}</Badge>
        ) : (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>
        )}
      </span>
      <span style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant={event.event_type === "trial" ? "warning" : "default"}>
          {event.event_type === "trial" ? "Trial" : "Standard"}
        </Badge>
      </span>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {event.event?.category.name ?? ""}
      </span>
      {/* Which parts of the tournament this event belongs to. The days are
          derivable from its shifts, but they are the same days its track
          already names — the track is the thing that isn't inferable. */}
      <span style={{ display: "flex", gap: "4px", flexWrap: "wrap", minWidth: 0 }}>
        {(() => {
          // An id with no name is a track the catalog hasn't loaded yet (or
          // one that has gone away). A badge reading "—" would claim the
          // event is on a track called nothing, so those are dropped and the
          // row falls back to the plain dash.
          const named = event.track_ids.filter((id) => trackNames.has(id));
          return named.length > 0
            ? named.map((id) => <Badge key={id}>{trackNames.get(id)}</Badge>)
            : <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>—</span>;
        })()}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center" }}>
        {event.shifts.length}
      </span>
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
