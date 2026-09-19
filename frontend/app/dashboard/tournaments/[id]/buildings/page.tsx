"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildingsApi, tournamentEventsApi, tournamentShiftsApi, canonicalEventsApi, rolesApi, ApiError,
  type TournamentBuilding, type TournamentEvent, type TournamentShift, type CanonicalEvent, type Role,
} from "@/lib/api";
import { EventPanel, EVENT_PANEL_WIDTH } from "@/components/tournament/events/EventPanel";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useTournament } from "@/lib/useTournament";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { useToast } from "@/lib/useToast";
import { formatTrackDates, placeOf } from "@/lib/tournamentDisplay";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { useRegisterBoardDnd } from "@/components/assignments/BoardDnd";
import { withTrackDetail, trackDetail } from "@/lib/eventTrackDetails";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabStrip } from "@/components/ui/TabStrip";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { IconBuilding, IconCalendar, IconLocation, IconPlus, IconEdit, IconTrash } from "@/components/ui/Icons";
import { BuildingColumn, parseColumnDropId } from "@/components/tournament/buildings/BuildingColumn";
import { EventChip, parseEventDragId } from "@/components/tournament/buildings/EventChip";
import { BuildingFormModal } from "@/components/tournament/buildings/BuildingFormModal";
import { UnplacedPanel, UNPLACED_PANEL_WIDTH } from "@/components/tournament/buildings/UnplacedPanel";
import {
  EventsFilterModal, EVENTS_FILTER_KEYS, EVENT_FILTER_UNSET, EVENT_TYPE_OPTIONS,
  eventCategoryKey, eventCategoryOptions, isEventsFilterActive,
  type EventsFilterState,
} from "@/components/tournament/events/EventsFilterModal";
import { emptyFilterState, filterAllows } from "@/components/ui/FilterModal";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";

/**
 * Placing events into buildings, one track at a time.
 *
 * Per track and not per tournament because that is how location is stored: an
 * event running both days holds a different building on each, so a board
 * showing "the" building for an event would have to pick one and lie about
 * the other.
 */
export default function BuildingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const { tracks, isSimple } = useTournament();
  const { isArchived } = useArchiveLock();
  const { show } = useToast();

  const canManageEvents =
    currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_events");

  const [buildings, setBuildings] = useState<TournamentBuilding[] | null>(null);
  const [events, setEvents] = useState<TournamentEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  // The tab the TD picked, or null for "whatever the first track is". Derived
  // rather than synced in an effect: tracks arrive with the tournament, which
  // the shell fetches, so a state default would have to be corrected after the
  // fact — and a picked track that is later deleted falls back on its own.
  // Seeded from ?track= so a reload lands on the same tab; a stale id falls
  // back through the same check below.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pickedTrackId, setPickedTrackId] = useState<number | null>(
    () => Number(searchParams.get("track")) || null,
  );
  function pickTrack(key: string) {
    setPickedTrackId(Number(key));
    router.replace(`${pathname}?track=${key}`, { scroll: false });
  }
  const activeTrackId =
    (pickedTrackId !== null && tracks.some((t) => t.id === pickedTrackId) ? pickedTrackId : tracks[0]?.id) ?? null;

  const [formTarget, setFormTarget] = useState<TournamentBuilding | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<TournamentBuilding | null>(null);

  const load = useCallback(() => {
    if (!canManageEvents) return;
    Promise.all([
      buildingsApi.list(tournamentId),
      // `location` is the group that carries track_details — without it every
      // event reads as unplaced.
      tournamentEventsApi.list(tournamentId, ["tracks", "location"]),
    ])
      .then(([b, e]) => { setBuildings(b); setEvents(e) })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load buildings."));
  }, [tournamentId, canManageEvents]);

  useEffect(() => { load() }, [load]);

  const columns = useMemo(
    () => (buildings ?? []).filter((b) => activeTrackId !== null && b.track_ids.includes(activeTrackId)),
    [buildings, activeTrackId],
  );

  // Only events that run on this track: an event with no link here has
  // nowhere to store a location, so it isn't unplaced — it's absent.
  const onTrack = useMemo(
    () => (events ?? []).filter((e) => activeTrackId !== null && trackDetail(e, activeTrackId) !== undefined),
    [events, activeTrackId],
  );

  const byBuilding = useMemo(() => {
    const groups = new Map<number | null, TournamentEvent[]>();
    for (const event of onTrack) {
      const id = trackDetail(event, activeTrackId!)?.building_id ?? null;
      const bucket = groups.get(id);
      if (bucket) bucket.push(event);
      else groups.set(id, [event]);
    }
    return groups;
  }, [onTrack, activeTrackId]);

  const unplaced = useMemo(() => byBuilding.get(null) ?? [], [byBuilding]);

  // ── the unplaced panel's search and filter ─────────────────────────────
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<EventsFilterState>(emptyFilterState(EVENTS_FILTER_KEYS));
  const [showFilterModal, setShowFilterModal] = useState(false);
  const filterActive = isEventsFilterActive(filters);

  // Options come from this track's events, not the whole tournament: a
  // division nothing here uses would be a row that can only match nothing.
  const divisionOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (const d of new Set(onTrack.map((e) => e.division))) {
      if (d !== null) options.push({ value: d, label: `Division ${d}` });
    }
    return onTrack.some((e) => e.division === null)
      ? [...options, { value: EVENT_FILTER_UNSET, label: "No division" }]
      : options;
  }, [onTrack]);
  const categoryOptions = useMemo(() => eventCategoryOptions(onTrack), [onTrack]);

  const visibleUnplaced = useMemo(() => {
    const text = query.trim().toLowerCase();
    return unplaced.filter((event) => (
      (!text || eventNameWithDivision(event).toLowerCase().includes(text))
      && filterAllows(filters.division, event.division ?? EVENT_FILTER_UNSET)
      && filterAllows(filters.type, event.event_type)
      && filterAllows(filters.category, eventCategoryKey(event))
    ));
  }, [unplaced, query, filters]);

  const { setPanel, clearPanel } = useSetLayoutPanel();

  // ── the event edit panel, docked beside the unplaced one ───────────────
  const [focusedEventId, setFocusedEventId] = useState<number | null>(null);
  const [panelDirty, setPanelDirty] = useState(false);
  // Catalogs the panel picks from. Fetched on first open, not on load — most
  // visits to this page never open it.
  const [canonicalEvents, setCanonicalEvents] = useState<CanonicalEvent[]>([]);
  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const catalogRequested = useRef(false);

  const openEvent = useCallback((id: number) => {
    if (id === focusedEventId) return;
    // Frozen while dirty, like the events page: switching would drop a draft.
    if (panelDirty) { show("Save or discard your changes first", "error"); return }
    setFocusedEventId(id);
    // The board's list omits most groups (shifts among them), which the panel
    // reads unguarded — so it opens on the full row, and only once that's here.
    tournamentEventsApi.get(tournamentId, id)
      .then((full) => setEvents((cur) => (cur ?? []).map((e) => (e.id === full.id ? full : e))))
      .catch(() => {});
    if (catalogRequested.current) return;
    catalogRequested.current = true;
    tournamentShiftsApi.list(tournamentId).then(setAllShifts).catch(() => setAllShifts([]));
    rolesApi.list(tournamentId).then(setRoles).catch(() => {});
    canonicalEventsApi.list().then(setCanonicalEvents).catch(() => {});
  }, [focusedEventId, panelDirty, tournamentId, show]);

  const closeEventPanel = useCallback(() => {
    setFocusedEventId(null);
    setPanelDirty(false);
  }, []);

  // Replace-or-append: tagging an existing building onto a track comes back
  // as that same row with a longer track_ids. Also what makes a building
  // created in the panel appear as a column here.
  const handleBuildingSaved = useCallback((building: TournamentBuilding) => {
    setBuildings((cur) => {
      const list = cur ?? [];
      return list.some((b) => b.id === building.id)
        ? list.map((b) => (b.id === building.id ? building : b))
        : [...list, building].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);
  const handleShiftCreated = useCallback(
    (shift: TournamentShift) => setAllShifts((prev) => [...(prev ?? []), shift]),
    [],
  );

  // The panel lives in the shell's slot, outside this page's tree, so it
  // is re-registered whenever anything it draws changes.
  useEffect(() => {
    if (!canManageEvents || events === null || activeTrackId === null) { clearPanel(); return }
    const focused = focusedEventId === null ? null : events.find((e) => e.id === focusedEventId) ?? null;
    // Deleted elsewhere while open.
    if (focusedEventId !== null && !focused) { closeEventPanel(); return }
    const panelReady = focused !== null && Array.isArray(focused.shifts);

    setPanel(
      <div style={{ display: "flex", height: "100%" }}>
      <UnplacedPanel
        query={query}
        onQueryChange={setQuery}
        filterActive={filterActive}
        onOpenFilter={() => setShowFilterModal(true)}
        onClearFilters={() => setFilters(emptyFilterState(EVENTS_FILTER_KEYS))}
        shown={visibleUnplaced.length}
        total={unplaced.length}
        locked={isArchived}
      >
        {visibleUnplaced.map((event) => (
          <EventChip
            key={event.id}
            event={{ id: event.id, name: eventNameWithDivision(event), detail: trackDetail(event, activeTrackId) }}
            locked={isArchived}
            placed={false}
            selected={event.id === focusedEventId}
            onOpen={() => openEvent(event.id)}
            onFloorChange={() => {}}
            onRoomsChange={() => {}}
          />
        ))}
      </UnplacedPanel>

      {panelReady && (
        <EventPanel
          key={focused.id}
          tournamentId={tournamentId}
          event={focused}
          locked={isArchived}
          canonicalEvents={canonicalEvents}
          allShifts={allShifts}
          tracks={tracks}
          buildings={buildings ?? []}
          roles={roles}
          onShiftCreated={handleShiftCreated}
          onBuildingSaved={handleBuildingSaved}
          onDirtyChange={setPanelDirty}
          onClose={closeEventPanel}
          onSaved={(saved) => setEvents((cur) => (cur ?? []).map((e) => (e.id === saved.id ? saved : e)))}
          onDeleted={(id) => setEvents((cur) => (cur ?? []).filter((e) => e.id !== id))}
        />
      )}
      </div>,
      UNPLACED_PANEL_WIDTH + (panelReady ? EVENT_PANEL_WIDTH : 0),
    );
  }, [
    canManageEvents, events, activeTrackId, query, filterActive, visibleUnplaced, unplaced.length,
    isArchived, focusedEventId, openEvent, closeEventPanel, canonicalEvents, allShifts, tracks,
    buildings, roles, handleShiftCreated, handleBuildingSaved, setPanel, clearPanel,
  ]);

  // Unmount only — leaving the page must not leave the panel behind.
  useEffect(() => () => clearPanel(), [clearPanel]);

  /**
   * One event's arrangement on the active track.
   *
   * Optimistic, then reverted on failure: a drag that waited for a round trip
   * before moving the chip reads as a dropped drag rather than a slow one.
   */
  const patchDetail = useCallback(async (
    eventId: number,
    updates: { building_id?: number | null; floor?: string | null; rooms?: string[] },
  ) => {
    if (activeTrackId === null) return;
    const before = events;
    const target = (events ?? []).find((e) => e.id === eventId);
    if (!target) return;

    const next = withTrackDetail(target, activeTrackId, updates);
    setEvents((cur) => (cur ?? []).map((e) => (
      e.id === eventId
        ? { ...e, track_details: e.track_details.map((d) => (
            d.track_id === activeTrackId
              ? { ...d, ...updates, building_name: d.building_name }
              : d
          )) }
        : e
    )));

    try {
      const saved = await tournamentEventsApi.update(tournamentId, eventId, { track_details: next });
      setEvents((cur) => (cur ?? []).map((e) => (e.id === eventId ? saved : e)));
    } catch (err) {
      setEvents(before);
      show(err instanceof ApiError ? err.message : "Couldn't save that.", "error");
    }
  }, [activeTrackId, events, tournamentId, show]);

  useRegisterBoardDnd("buildings", {
    onDragEnd: ({ active, over }) => {
      if (!over) return;
      const eventId = parseEventDragId(String(active.id));
      const column = parseColumnDropId(String(over.id));
      if (eventId === null || !column || activeTrackId === null) return;

      const current = trackDetail(
        (events ?? []).find((e) => e.id === eventId) ?? { track_details: [] } as never,
        activeTrackId,
      );
      if (!current || current.building_id === column.buildingId) return;

      // Floor and rooms describe a place inside the old building, so they go
      // with it. Keeping "210" while moving to another building would assert
      // a room that may not exist there.
      patchDetail(eventId, { building_id: column.buildingId, floor: null, rooms: [] });
    },
    renderOverlay: (activeId) => {
      const eventId = parseEventDragId(activeId);
      const event = eventId === null ? undefined : (events ?? []).find((e) => e.id === eventId);
      if (!event) return null;
      return (
        <div style={{
          padding: "8px 10px", borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border-strong)", background: "var(--color-surface)",
          boxShadow: "var(--shadow-lg)",
          fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
        }}>
          {eventNameWithDivision(event)}
        </div>
      );
    },
  });

  if (membershipLoading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
  }

  if (!canManageEvents) {
    return (
      <div>
        <PageHeader heading="Buildings" />
        <EmptyState icon={<IconBuilding size={28} />} title="No access" description="You need permission to manage events to place them in buildings." />
      </div>
    );
  }

  if (buildings === null || events === null) {
    return (
      <div>
        <PageHeader heading="Buildings" />
        {loadError
          ? <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{loadError}</p>
          : <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>}
      </div>
    );
  }

  function renderChips(list: TournamentEvent[]) {
    return list.map((event) => (
      <EventChip
        key={event.id}
        event={{ id: event.id, name: eventNameWithDivision(event), detail: trackDetail(event, activeTrackId!) }}
        locked={isArchived}
        placed
        selected={event.id === focusedEventId}
        onOpen={() => openEvent(event.id)}
        onRemove={() => patchDetail(event.id, { building_id: null, floor: null, rooms: [] })}
        onFloorChange={(floor) => patchDetail(event.id, { floor: floor.trim() || null })}
        onRoomsChange={(rooms) => patchDetail(event.id, { rooms })}
      />
    ));
  }

  // Where and when the active track runs. Dates only — a track has no time of
  // its own, its shifts do.
  const activeTrack = tracks.find((t) => t.id === activeTrackId);
  const trackPlace = activeTrack ? placeOf(activeTrack) : null;
  const trackDates = activeTrack ? formatTrackDates(activeTrack) : null;

  const addButton = (
    <Button type="button" variant="primary" size="md" disabled={isArchived} onClick={() => setFormTarget("new")} style={{ flexShrink: 0 }}>
      <IconPlus size={14} /> Add building
    </Button>
  );

  return (
    <div>
      <PageHeader heading="Buildings" />

      {/* Hidden in simple mode: with one track every event's location is on
          it, so a one-tab strip would be furniture. */}
      {!isSimple && tracks.length > 0 && activeTrackId !== null && (
        <TabStrip
          tabs={tracks.map((t) => ({ key: String(t.id), label: t.name }))}
          activeKey={String(activeTrackId)}
          onChange={pickTrack}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
        {/* Same 36px as the md button beside it, so the row reads as one line. */}
        <div style={{
          display: "flex", alignItems: "center", gap: "14px", height: "36px", padding: "0 12px",
          borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)",
          background: "var(--color-surface)", minWidth: 0,
          fontFamily: "var(--font-sans)", fontSize: "13px",
        }}>
          <span style={{
            display: "flex", alignItems: "center", gap: "6px", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: trackPlace ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
          }}>
            <IconLocation />{trackPlace ?? "No location"}
          </span>
          <span style={{
            display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap",
            color: trackDates ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
          }}>
            <IconCalendar />{trackDates ?? "No date"}
          </span>
        </div>
        {addButton}
      </div>

      {columns.length === 0 ? (
        <EmptyState
          icon={<IconBuilding size={28} />}
          title="No buildings yet"
          description="Add the buildings this track runs in, then drag events into them."
        />
      ) : (
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", overflowX: "auto", paddingBottom: "8px" }}>
          {columns.map((building) => {
            const list = byBuilding.get(building.id) ?? [];
            return (
              <BuildingColumn
                key={building.id}
                buildingId={building.id}
                title={building.name}
                count={list.length}
                emptyText="Drop an event here."
                actions={!isArchived && (
                  <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setFormTarget(building)} aria-label={`Edit ${building.name}`}>
                      <IconEdit />
                    </Button>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setDeleteTarget(building)} aria-label={`Delete ${building.name}`}>
                      <IconTrash style={{ color: "var(--color-danger)" }} />
                    </Button>
                  </div>
                )}
              >
                {renderChips(list)}
              </BuildingColumn>
            );
          })}
        </div>
      )}

      {formTarget !== null && (
        <BuildingFormModal
          tournamentId={tournamentId}
          building={formTarget === "new" ? null : formTarget}
          tracks={tracks}
          defaultTrackId={activeTrackId}
          onClose={() => setFormTarget(null)}
          // Reload rather than splice: untagging a track clears the event
          // locations that pointed here, and only a refetch knows which.
          onSaved={() => load()}
        />
      )}

      {showFilterModal && (
        <EventsFilterModal
          divisionOptions={divisionOptions}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={categoryOptions}
          filters={filters}
          onApply={setFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete ${deleteTarget.name}?`}
          description="Events placed here will be moved back to unplaced. This can't be undone."
          confirmLabel="Delete"
          variant="danger"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const result = await buildingsApi.delete(tournamentId, deleteTarget.id);
            load();
            show(result.locations_cleared > 0
              ? `Deleted. ${result.locations_cleared} event location${result.locations_cleared === 1 ? "" : "s"} cleared.`
              : "Building deleted.");
          }}
        />
      )}
    </div>
  );
}
