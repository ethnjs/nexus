"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { useRegisterBoardDnd } from "@/components/tournament/assignments/BoardDnd";
import { AddBuildingModal } from "@/components/tournament/buildings/AddBuildingModal";
import { BuildingSection } from "@/components/tournament/buildings/BuildingSection";
import { EventCardDisplayModal } from "@/components/tournament/buildings/EventCardDisplayModal";
import { EventChip, parseRoomChipDragId } from "@/components/tournament/buildings/EventChip";
import {
  EVENT_CARD_FIELDS,
  EVENT_FIELD_PREFIX,
  EVENT_LIST_DROP_ID,
  type EventCardField,
  EventListCard,
  EventListDropZone,
  parseEventDragId,
} from "@/components/tournament/buildings/EventListCard";
import { ImportRoomsModal } from "@/components/tournament/buildings/ImportRoomsModal";
import { RoomEventsCell } from "@/components/tournament/buildings/RoomEventsCell";
import {
  parseNewRoomDropId,
  parseRoomDropId,
  RoomTable,
} from "@/components/tournament/buildings/RoomTable";
import { EVENT_PANEL_WIDTH, EventPanel } from "@/components/tournament/events/EventPanel";
import {
  EVENT_TYPE_OPTIONS,
  EventsFilterModal,
  type EventsFilterState,
  eventBuildingOptions,
  eventCategoryOptions,
  eventDivisionOptions,
  eventPassesFilters,
  eventShiftOptions,
  eventsFilterFromStored,
  eventsFilterToStored,
  isEventsFilterActive,
} from "@/components/tournament/events/EventsFilterModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DisplayButton } from "@/components/ui/DisplayButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterButton } from "@/components/ui/FilterButton";
import {
  IconBuilding,
  IconCalendar,
  IconEvents,
  IconLocation,
  IconLock,
  IconPlus,
  IconSearch,
  IconUpload,
} from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { MasonryGrid } from "@/components/ui/MasonryGrid";
import { SelectionBar } from "@/components/ui/SelectionBar";
import { Spinner } from "@/components/ui/Spinner";
import table from "@/components/ui/Table.module.css";
import {
  ApiError,
  buildingsApi,
  type CanonicalEvent,
  canonicalEventsApi,
  type DisplayConfig,
  displayConfigApi,
  type Role,
  rolesApi,
  type TournamentBuilding,
  type TournamentEvent,
  type TournamentRoom,
  type TournamentShift,
  type TournamentTrack,
  tabSurface,
  tournamentEventsApi,
  tournamentShiftsApi,
} from "@/lib/api";
import { BUILDINGS_EVENTS } from "@/lib/displayConfigSurfaces";
import { eventNameWithDivision, trackLocationLabel } from "@/lib/eventDisplay";
import { trackDetail, withTrackDetail } from "@/lib/eventTrackDetails";
import { persistSurfaceView } from "@/lib/persistSurfaceView";
import { formatTrackDates, placeOfTrack } from "@/lib/tournamentDisplay";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { useAuth } from "@/lib/useAuth";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { useMyMembership } from "@/lib/useMyMembership";
import { replaceSearchParams, useInitialPanelId, usePanelUrlSync } from "@/lib/usePanelUrl";
import { useToast } from "@/lib/useToast";
import { useTournament } from "@/lib/useTournament";

export default function BuildingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageEvents =
    currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_events");
  const { isArchived, archivedReason } = useArchiveLock();
  const { tracks } = useTournament();
  const { show } = useToast();

  const days = useMemo(() => tracks.filter((t) => t.is_primary), [tracks]);

  // Mirrored into ?track= so a reload comes back to the same day. A stale id
  // falls back to the first day.
  const searchParams = useSearchParams();
  const [pickedTrackId, setPickedTrackId] = useState<number | null>(
    () => Number(searchParams.get("track")) || null,
  );
  const activeTrackId =
    pickedTrackId !== null && days.some((t) => t.id === pickedTrackId)
      ? pickedTrackId
      : (days[0]?.id ?? null);
  const activeTrack = days.find((t) => t.id === activeTrackId) ?? null;

  // Memoised: CollapsibleHeader re-registers the Topbar's copy whenever this
  // identity changes.
  const headerTabs = useMemo(() => days.map((t) => ({ key: String(t.id), label: t.name })), [days]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<ReadonlySet<number>>(new Set());
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedRoomIds(new Set());
  }, []);
  const pickTab = useCallback((key: string) => {
    // A selection covers what's on screen, so it doesn't follow you to another day.
    setSelectedRoomIds(new Set());
    setPickedTrackId(Number(key));
    const params = new URLSearchParams(window.location.search);
    params.set("track", key);
    replaceSearchParams(params);
  }, []);

  const [buildings, setBuildings] = useState<TournamentBuilding[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  const [events, setEvents] = useState<TournamentEvent[] | null>(null);

  const loadEvents = useCallback(
    () =>
      // Every group: the cards show shifts, and the event panel edits all of it.
      tournamentEventsApi
        .list(tournamentId)
        .then(setEvents)
        .catch((err) =>
          setLoadError(err instanceof ApiError ? err.message : "Failed to load events."),
        ),
    [tournamentId],
  );

  useEffect(() => {
    if (!canManageEvents) return;
    buildingsApi
      .list(tournamentId)
      .then(setBuildings)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Failed to load buildings."),
      );
    void loadEvents();
  }, [tournamentId, canManageEvents, loadEvents]);

  // Only events on this day: one with no link to the track has nowhere to
  // store a location here.
  const dayEvents = useMemo(
    () =>
      (events ?? [])
        .filter((e) => activeTrackId !== null && trackDetail(e, activeTrackId) !== undefined)
        .sort((a, b) => eventNameWithDivision(a).localeCompare(eventNameWithDivision(b))),
    [events, activeTrackId],
  );

  const eventsByRoom = useMemo(() => {
    const byRoom = new Map<number, TournamentEvent[]>();
    if (activeTrackId === null) return byRoom;
    for (const event of dayEvents) {
      for (const roomId of trackDetail(event, activeTrackId)?.room_ids ?? []) {
        byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), event]);
      }
    }
    return byRoom;
  }, [dayEvents, activeTrackId]);

  const replaceEvent = (next: TournamentEvent) =>
    setEvents((cur) => (cur ?? []).map((e) => (e.id === next.id ? { ...e, ...next } : e)));

  async function saveLocation(
    event: TournamentEvent,
    updates: { floor?: null; room_ids?: number[] },
  ) {
    if (activeTrackId === null) return;
    try {
      replaceEvent(
        await tournamentEventsApi.update(tournamentId, event.id, {
          track_details: withTrackDetail(event, activeTrackId, updates),
        }),
      );
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to move event.", "error");
    }
  }

  /** In the same building, the room is added; from anywhere else, the event moves here. */
  function placeEvent(event: TournamentEvent, building: TournamentBuilding, room: TournamentRoom) {
    const detail = activeTrackId === null ? undefined : trackDetail(event, activeTrackId);
    if (detail?.building_id === building.id) {
      return saveLocation(event, { room_ids: [...detail.room_ids, room.id] });
    }
    return saveLocation(event, { floor: null, room_ids: [room.id] });
  }

  /** Out of its last room, the event is unplaced. */
  /** A list card moves the event to this room alone; a chip dragged from
   *  another room of the same building swaps that room for this one. */
  function moveEvent(
    event: TournamentEvent,
    toBuildingId: number,
    toRoomId: number,
    fromRoomId: number | null,
  ) {
    const detail = activeTrackId === null ? undefined : trackDetail(event, activeTrackId);
    const current = detail?.room_ids ?? [];
    if (fromRoomId === toRoomId) return;
    if (fromRoomId !== null && detail?.building_id === toBuildingId) {
      const kept = current.filter((id) => id !== fromRoomId && id !== toRoomId);
      return saveLocation(event, { room_ids: [...kept, toRoomId] });
    }
    if (current.length === 1 && current[0] === toRoomId) return;
    return saveLocation(event, { floor: null, room_ids: [toRoomId] });
  }
  function removeFromRoom(event: TournamentEvent, roomId: number) {
    const detail = activeTrackId === null ? undefined : trackDetail(event, activeTrackId);
    const remaining = (detail?.room_ids ?? []).filter((id) => id !== roomId);
    return saveLocation(
      event,
      remaining.length > 0 ? { room_ids: remaining } : { floor: null, room_ids: [] },
    );
  }

  function candidatesFor(roomId: number) {
    if (activeTrackId === null) return [];
    return dayEvents
      .filter((e) => !trackDetail(e, activeTrackId)?.room_ids.includes(roomId))
      .map((event) => ({
        event,
        location: trackLocationLabel(trackDetail(event, activeTrackId)),
      }));
  }

  const onTab = useMemo(
    () =>
      (buildings ?? []).filter(
        (b) => activeTrackId !== null && b.track_ids.includes(activeTrackId),
      ),
    [buildings, activeTrackId],
  );
  const hasBuildings = (buildings?.length ?? 0) > 0;

  // ── the docked event list ─────────────────────────────────────────────
  // Each day tab keeps its own card fields and filters ("buildings_events:track:3").
  const [displayConfig, setDisplayConfig] = useState<DisplayConfig | null>(null);
  useEffect(() => {
    if (!canManageEvents) return;
    displayConfigApi
      .get(tournamentId)
      .then(setDisplayConfig)
      .catch(() => setDisplayConfig({}));
  }, [tournamentId, canManageEvents]);
  const surface = tabSurface(BUILDINGS_EVENTS, activeTrackId);
  const saved = displayConfig?.[surface];
  const hiddenFields = useMemo(
    () =>
      new Set(
        (saved?.hidden ?? [])
          .filter((item) => item.startsWith(EVENT_FIELD_PREFIX))
          .map((item) => item.slice(EVENT_FIELD_PREFIX.length) as EventCardField)
          .filter((id) => EVENT_CARD_FIELDS.some((f) => f.id === id)),
      ),
    [saved],
  );
  const filters = useMemo(() => eventsFilterFromStored(saved?.filters), [saved]);
  const filterActive = isEventsFilterActive(filters);

  function saveView(patch: { hidden?: string[]; filters?: Record<string, string[]> }) {
    setDisplayConfig((cur) => ({
      ...cur,
      [surface]: { ...{ hidden: [] }, ...cur?.[surface], ...patch },
    }));
    void persistSurfaceView(tournamentId, surface, patch);
  }
  const applyHidden = (next: Set<EventCardField>) =>
    saveView({ hidden: [...next].map((id) => `${EVENT_FIELD_PREFIX}${id}`) });
  const applyFilters = (next: EventsFilterState) =>
    saveView({ filters: eventsFilterToStored(next) });

  const [query, setQuery] = useState("");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showDisplayModal, setShowDisplayModal] = useState(false);

  const listed = useMemo(() => {
    if (activeTrackId === null) return [];
    const needle = query.trim().toLowerCase();
    const ctx = {
      // Assignments aren't loaded here; the staffing filter is hidden.
      assignmentsFor: () => [],
      showsTrack: (id: number) => id === activeTrackId,
      trackOverride: new Set([String(activeTrackId)]),
    };
    return dayEvents.filter(
      (e) =>
        eventNameWithDivision(e).toLowerCase().includes(needle) &&
        eventPassesFilters(e, filters, ctx),
    );
  }, [dayEvents, query, filters, activeTrackId]);

  // ── the event panel ───────────────────────────────────────────────────
  const [focusedEventId, setFocusedEventId] = useState<number | null>(useInitialPanelId("event"));
  usePanelUrlSync("event", focusedEventId);
  const focusedEvent = (events ?? []).find((e) => e.id === focusedEventId) ?? null;
  const [allShifts, setAllShifts] = useState<TournamentShift[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [canonicalEvents, setCanonicalEvents] = useState<CanonicalEvent[]>([]);
  const [panelDataLoaded, setPanelDataLoaded] = useState(false);
  useEffect(() => {
    if (focusedEventId === null || panelDataLoaded) return;
    setPanelDataLoaded(true);
    tournamentShiftsApi
      .list(tournamentId)
      .then(setAllShifts)
      .catch(() => {});
    rolesApi
      .list(tournamentId)
      .then(setRoles)
      .catch(() => {});
    canonicalEventsApi
      .list()
      .then(setCanonicalEvents)
      .catch(() => {});
  }, [focusedEventId, panelDataLoaded, tournamentId]);

  const openEvent = useCallback((id: number) => setFocusedEventId(id), []);

  const { setPanel, clearPanel } = useSetLayoutPanel();
  useEffect(() => clearPanel, [clearPanel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel's handlers are recreated each render
  useEffect(() => {
    if (!canManageEvents || activeTrackId === null || days.length === 0) return;
    const index = focusedEvent ? listed.findIndex((e) => e.id === focusedEvent.id) : -1;
    setPanel(
      <div style={{ display: "flex", height: "100%" }}>
        <DockedPanel
          width={LIST_PANEL_WIDTH}
          headerActions={
            <>
              <DisplayButton
                size="sm"
                iconOnly
                label="Configure event cards"
                active={hiddenFields.size > 0}
                onOpen={() => setShowDisplayModal(true)}
                onReset={() => applyHidden(new Set())}
              />
              <FilterButton
                size="sm"
                iconOnly
                label="Filter events"
                active={filterActive}
                onOpen={() => setShowFilterModal(true)}
                onClear={() => applyFilters(eventsFilterFromStored(null))}
              />
            </>
          }
        >
          <EventListDropZone>
            <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                placeholder="Search events"
                icon={<IconSearch />}
                size="md"
                variant="secondary"
                font="sans"
                fullWidth
              />
              <span className={table.headerLabel}>
                Events — {listed.length}/{dayEvents.length}
              </span>
              {listed.length === 0 ? (
                <Card radius="lg" style={{ padding: "8px" }}>
                  <EmptyState
                    icon={<IconEvents size={24} />}
                    title={query || filterActive ? "No events match" : "No events on this day"}
                    description={query || filterActive ? "Try a wider filter." : undefined}
                    action={
                      query || filterActive ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setQuery("");
                            applyFilters(eventsFilterFromStored(null));
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                </Card>
              ) : (
                listed.map((event) => (
                  <EventListCard
                    key={event.id}
                    event={event}
                    trackId={activeTrackId}
                    hidden={hiddenFields}
                    selected={event.id === focusedEventId}
                    locked={isArchived}
                    onOpen={openEvent}
                  />
                ))
              )}
            </div>
          </EventListDropZone>
        </DockedPanel>
        {focusedEvent && (
          <EventPanel
            key={focusedEvent.id}
            tournamentId={tournamentId}
            event={focusedEvent}
            locked={isArchived}
            canonicalEvents={canonicalEvents}
            allShifts={allShifts}
            tracks={tracks}
            buildings={buildings ?? []}
            roles={roles}
            onShiftCreated={(shift) => setAllShifts((prev) => [...prev, shift])}
            onBuildingSaved={(building) =>
              setBuildings((cur) =>
                (cur ?? []).some((b) => b.id === building.id)
                  ? (cur ?? []).map((b) => (b.id === building.id ? building : b))
                  : [...(cur ?? []), building],
              )
            }
            onClose={() => setFocusedEventId(null)}
            onSaved={replaceEvent}
            onDeleted={(id) => {
              setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
              setFocusedEventId(null);
            }}
            onPrev={() => index > 0 && setFocusedEventId(listed[index - 1].id)}
            onNext={() =>
              index >= 0 && index < listed.length - 1 && setFocusedEventId(listed[index + 1].id)
            }
            hasPrev={index > 0}
            hasNext={index >= 0 && index < listed.length - 1}
          />
        )}
      </div>,
      LIST_PANEL_WIDTH + (focusedEvent ? EVENT_PANEL_WIDTH : 0),
    );
  }, [
    canManageEvents,
    activeTrackId,
    days.length,
    listed,
    dayEvents.length,
    query,
    filterActive,
    hiddenFields,
    focusedEvent,
    focusedEventId,
    isArchived,
    canonicalEvents,
    allShifts,
    roles,
    buildings,
    tracks,
    setPanel,
    openEvent,
  ]);

  // ── drag and drop ────────────────────────────────────────────────────
  // Drops: on a room moves the event there (see moveEvent), on Add room
  // waits for the new room's name, and a room chip on the list leaves its room.
  useRegisterBoardDnd("buildings", {
    onDragEnd: ({ active, over }) => {
      if (!over || activeTrackId === null) return;
      const chip = parseRoomChipDragId(String(active.id));
      const eventId = chip?.eventId ?? parseEventDragId(String(active.id));
      const event = eventId === null ? undefined : (events ?? []).find((e) => e.id === eventId);
      if (!event) return;
      const overId = String(over.id);
      if (overId === EVENT_LIST_DROP_ID) {
        if (chip) void removeFromRoom(event, chip.roomId);
        return;
      }
      const newRoomBuildingId = parseNewRoomDropId(overId);
      if (newRoomBuildingId !== null) {
        setPendingDrop({
          buildingId: newRoomBuildingId,
          eventId: event.id,
          fromRoomId: chip?.roomId ?? null,
        });
        return;
      }
      const roomId = parseRoomDropId(overId);
      const building = onTab.find((b) => b.rooms.some((r) => r.id === roomId));
      if (roomId === null || !building) return;
      void moveEvent(event, building.id, roomId, chip?.roomId ?? null);
    },
    renderOverlay: (activeId) => {
      const eventId = parseRoomChipDragId(activeId)?.eventId ?? parseEventDragId(activeId);
      const event = eventId === null ? null : (events ?? []).find((e) => e.id === eventId);
      if (!event) return null;
      return (
        <div
          style={{
            padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-strong)",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          {eventNameWithDivision(event)}
        </div>
      );
    },
  });

  const replaceBuilding = (next: TournamentBuilding) =>
    setBuildings((cur) => (cur ?? []).map((b) => (b.id === next.id ? next : b)));

  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // An event dropped on a building's Add room, waiting for the room to be named.
  const [pendingDrop, setPendingDrop] = useState<{
    buildingId: number;
    eventId: number;
    fromRoomId: number | null;
  } | null>(null);

  async function renameBuilding(building: TournamentBuilding, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === building.name) return;
    replaceBuilding(await buildingsApi.update(tournamentId, building.id, { name: trimmed }));
    if (!building.short_name) void loadEvents();
  }

  async function setShortName(building: TournamentBuilding, shortName: string | null) {
    if (shortName === building.short_name) return;
    replaceBuilding(
      await buildingsApi.update(tournamentId, building.id, { short_name: shortName }),
    );
    // Placed events carry the building's label, so they need the new one.
    void loadEvents();
  }

  async function toggleDay(building: TournamentBuilding, trackId: number) {
    const next = building.track_ids.includes(trackId)
      ? building.track_ids.filter((id) => id !== trackId)
      : [...building.track_ids, trackId];
    try {
      replaceBuilding(await buildingsApi.update(tournamentId, building.id, { track_ids: next }));
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to update days.", "error");
    }
  }

  const setRooms = (buildingId: number, rooms: (cur: TournamentRoom[]) => TournamentRoom[]) =>
    setBuildings((cur) =>
      (cur ?? []).map((b) => (b.id === buildingId ? { ...b, rooms: rooms(b.rooms) } : b)),
    );

  async function addRoom(building: TournamentBuilding, name: string) {
    try {
      const rooms = await buildingsApi.addRooms(tournamentId, building.id, [name]);
      setRooms(building.id, () => rooms);
      const room = rooms.find((r) => r.name === name.trim());
      if (!room) throw new Error("Failed to add room.");
      const pending = pendingDrop?.buildingId === building.id ? pendingDrop : null;
      const pendingEvent = pending && (events ?? []).find((e) => e.id === pending.eventId);
      if (pending) setPendingDrop(null);
      if (pending && pendingEvent)
        void moveEvent(pendingEvent, building.id, room.id, pending.fromRoomId);
      return room;
    } catch (err) {
      throw new Error(err instanceof ApiError ? err.message : "Failed to add rooms.");
    }
  }

  async function updateRoom(
    building: TournamentBuilding,
    room: TournamentRoom,
    body: { name?: string; floor?: string | null },
  ) {
    const saved = await buildingsApi.updateRoom(tournamentId, building.id, room.id, body);
    // A rename can change where the room sorts, so re-sort the way the server does.
    setRooms(building.id, (rooms) => sortRooms(rooms.map((r) => (r.id === saved.id ? saved : r))));
  }

  async function deleteRoom(building: TournamentBuilding, room: TournamentRoom) {
    await buildingsApi.deleteRoom(tournamentId, building.id, room.id);
    setRooms(building.id, (rooms) => rooms.filter((r) => r.id !== room.id));
    if (eventsByRoom.has(room.id)) void loadEvents();
  }

  function toggleRoom(roomId: number) {
    setSelectedRoomIds((cur) => {
      const next = new Set(cur);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }

  function toggleRooms(roomIds: number[], checked: boolean) {
    setSelectedRoomIds((cur) => {
      const next = new Set(cur);
      for (const id of roomIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const selectedRooms = onTab.flatMap((building) =>
    building.rooms.filter((r) => selectedRoomIds.has(r.id)).map((room) => ({ building, room })),
  );
  const [bulkDeleting, setBulkDeleting] = useState(false);

  /** One request per room; the ones deleted before a failure stay deleted. */
  async function deleteSelectedRooms() {
    let unplaced = false;
    try {
      for (const { building, room } of selectedRooms) {
        await buildingsApi.deleteRoom(tournamentId, building.id, room.id);
        setRooms(building.id, (rooms) => rooms.filter((r) => r.id !== room.id));
        setSelectedRoomIds((cur) => {
          const next = new Set(cur);
          next.delete(room.id);
          return next;
        });
        unplaced ||= eventsByRoom.has(room.id);
      }
    } finally {
      if (unplaced) void loadEvents();
    }
  }

  const [roomDeleteTarget, setRoomDeleteTarget] = useState<{
    building: TournamentBuilding;
    room: TournamentRoom;
  } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<TournamentBuilding | null>(null);

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
        <CollapsibleHeader heading="Buildings" />
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

  if (days.length === 0) {
    return (
      <div>
        <CollapsibleHeader heading="Buildings" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconBuilding size={28} />}
            title="No competition days"
            description="Add a competition day in settings before adding buildings."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* One day: the header collapses to the title alone. */}
      <CollapsibleHeader
        heading="Buildings"
        tabs={days.length > 1 ? headerTabs : undefined}
        activeKey={activeTrackId === null ? undefined : String(activeTrackId)}
        onChange={pickTab}
      />

      {loadError && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            marginBottom: "12px",
          }}
        >
          {loadError}
        </p>
      )}

      {buildings === null && !loadError ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "10px",
              marginBottom: "12px",
            }}
          >
            {activeTrack ? <TrackSummary track={activeTrack} /> : <span />}
            {!isArchived && hasBuildings && (
              <div style={{ display: "flex", gap: "10px" }}>
                <Button
                  type="button"
                  variant={selectMode ? "primary" : "secondary"}
                  size="md"
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  disabled={onTab.length === 0}
                >
                  Select
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setImporting(true)}
                >
                  <IconUpload size={14} /> Import
                </Button>
                <Button type="button" variant="primary" size="md" onClick={() => setAdding(true)}>
                  <IconPlus size={14} /> Add building
                </Button>
              </div>
            )}
          </div>

          {onTab.length === 0 && (
            <Card radius="lg" style={{ padding: "8px" }}>
              {hasBuildings ? (
                <EmptyState
                  icon={<IconBuilding size={28} />}
                  title="No buildings on this day"
                  description="Add one, or turn this day on for a building from another day."
                />
              ) : (
                <EmptyState
                  icon={<IconBuilding size={28} />}
                  title="No buildings yet"
                  description="Import a list of buildings and rooms, or add them one at a time."
                  action={
                    <div style={{ display: "flex", gap: "10px" }}>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setImporting(true)}
                        disabled={isArchived}
                        title={archivedReason}
                      >
                        <IconUpload size={12} /> Import
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setAdding(true)}
                        disabled={isArchived}
                        title={archivedReason}
                      >
                        <IconPlus size={12} /> Add building
                      </Button>
                    </div>
                  }
                />
              )}
            </Card>
          )}

          {onTab.length > 0 && (
            <MasonryGrid minColumnWidth={460} gap={16}>
              {onTab.map((building) => (
                <BuildingSection
                  key={building.id}
                  building={building}
                  days={days}
                  locked={isArchived || selectMode}
                  lockedReason={archivedReason}
                  onRename={(name) => renameBuilding(building, name)}
                  onSetShortName={(shortName) => setShortName(building, shortName)}
                  onToggleDay={(trackId) => toggleDay(building, trackId)}
                  onDelete={() => setDeleteTarget(building)}
                >
                  <RoomTable
                    buildingId={building.id}
                    buildingName={building.short_name || building.name}
                    pendingEvents={(() => {
                      if (pendingDrop?.buildingId !== building.id) return undefined;
                      const event = (events ?? []).find((e) => e.id === pendingDrop.eventId);
                      return event ? (
                        <EventChip
                          event={event}
                          roomId={0}
                          locked
                          onOpen={openEvent}
                          onRemove={() => {}}
                        />
                      ) : undefined;
                    })()}
                    onPendingCancel={() => setPendingDrop(null)}
                    rooms={building.rooms}
                    locked={isArchived}
                    selectMode={selectMode}
                    selectedIds={selectedRoomIds}
                    onToggleSelect={toggleRoom}
                    onToggleSelectAll={toggleRooms}
                    onAdd={(name) => addRoom(building, name)}
                    onRename={async (room, name) => {
                      const trimmed = name.trim();
                      if (trimmed && trimmed !== room.name)
                        await updateRoom(building, room, { name: trimmed });
                    }}
                    onSetFloor={(room, floor) =>
                      floor === room.floor
                        ? Promise.resolve()
                        : updateRoom(building, room, { floor })
                    }
                    onDelete={(room) => {
                      if (eventsByRoom.has(room.id)) setRoomDeleteTarget({ building, room });
                      else
                        deleteRoom(building, room).catch((err) =>
                          show(
                            err instanceof ApiError ? err.message : "Failed to delete room.",
                            "error",
                          ),
                        );
                    }}
                    renderEvents={(room) => (
                      <RoomEventsCell
                        roomId={room.id}
                        events={eventsByRoom.get(room.id) ?? []}
                        candidates={candidatesFor(room.id)}
                        locked={isArchived || selectMode}
                        onAdd={(event) => placeEvent(event, building, room)}
                        onRemove={(event) => removeFromRoom(event, room.id)}
                        onOpen={openEvent}
                      />
                    )}
                  />
                </BuildingSection>
              ))}
            </MasonryGrid>
          )}
        </>
      )}

      <SelectionBar
        visible={selectMode && !bulkDeleting}
        count={selectedRooms.length}
        editLabel="Delete"
        onEdit={() => setBulkDeleting(true)}
        onCancel={exitSelectMode}
      />

      {bulkDeleting && (
        <ConfirmModal
          title={`Delete ${selectedRooms.length} ${selectedRooms.length === 1 ? "room" : "rooms"}?`}
          description={(() => {
            const placed = new Set(
              selectedRooms.flatMap(({ room }) =>
                (eventsByRoom.get(room.id) ?? []).map((e) => e.id),
              ),
            ).size;
            return placed > 0
              ? `${placed} ${placed === 1 ? "event is" : "events are"} placed in them. They'll be taken out of these rooms, and unplaced if they have no other room left.`
              : "None of them have events placed in them.";
          })()}
          confirmLabel="Delete"
          onConfirm={deleteSelectedRooms}
          onConfirmed={exitSelectMode}
          onClose={() => setBulkDeleting(false)}
        />
      )}

      {showDisplayModal && (
        <EventCardDisplayModal
          hidden={hiddenFields}
          onApply={applyHidden}
          onClose={() => setShowDisplayModal(false)}
        />
      )}

      {showFilterModal && (
        <EventsFilterModal
          divisionOptions={eventDivisionOptions(dayEvents)}
          typeOptions={EVENT_TYPE_OPTIONS}
          categoryOptions={eventCategoryOptions(dayEvents)}
          buildingOptions={eventBuildingOptions(dayEvents)}
          shiftOptions={eventShiftOptions(dayEvents)}
          showStaffing={false}
          filters={filters}
          onApply={applyFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}

      {adding && (
        <AddBuildingModal
          tournamentId={tournamentId}
          trackIds={days.map((t) => t.id)}
          onClose={() => setAdding(false)}
          onCreated={(created) => setBuildings((cur) => [...(cur ?? []), created])}
        />
      )}

      {importing && (
        <ImportRoomsModal
          tournamentId={tournamentId}
          trackIds={days.map((t) => t.id)}
          buildings={buildings ?? []}
          onClose={() => setImporting(false)}
          onImported={(imported) =>
            setBuildings((cur) => {
              const kept = (cur ?? []).map((b) => imported.find((i) => i.id === b.id) ?? b);
              const added = imported.filter((i) => !kept.some((b) => b.id === i.id));
              return [...kept, ...added];
            })
          }
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete ${deleteTarget.name}?`}
          description="Its rooms are deleted too, and events placed here go back to unplaced on every day. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => buildingsApi.delete(tournamentId, deleteTarget.id)}
          onConfirmed={() => {
            setBuildings((cur) => (cur ?? []).filter((b) => b.id !== deleteTarget.id));
            void loadEvents();
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {roomDeleteTarget && (
        <ConfirmModal
          title={`Delete room ${roomDeleteTarget.room.name}?`}
          description={`${(eventsByRoom.get(roomDeleteTarget.room.id) ?? [])
            .map(eventNameWithDivision)
            .join(
              ", ",
            )} will be taken out of this room, and unplaced if it has no other room here.`}
          confirmLabel="Delete"
          onConfirm={() => deleteRoom(roomDeleteTarget.building, roomDeleteTarget.room)}
          onClose={() => setRoomDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/** The day's name, dates and venue, beside the page's buttons. */
function TrackSummary({ track }: { track: TournamentTrack }) {
  const dates = formatTrackDates(track, "weekday");
  const place = placeOfTrack(track);
  const fact = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
    color: "var(--color-text-secondary)",
  } as const;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px 16px",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        {track.name}
      </span>
      {dates && (
        <span style={fact}>
          <IconCalendar /> {dates}
        </span>
      )}
      {place && (
        <span style={fact}>
          <IconLocation /> {place}
        </span>
      )}
    </div>
  );
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural order, matching the server: "9" before "10". */
function sortRooms(rooms: TournamentRoom[]): TournamentRoom[] {
  return [...rooms].sort((a, b) => collator.compare(a.name, b.name));
}

const LIST_PANEL_WIDTH = 320;
