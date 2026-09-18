"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  buildingsApi, tournamentEventsApi, ApiError,
  type TournamentBuilding, type TournamentEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useTournament } from "@/lib/useTournament";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { useToast } from "@/lib/useToast";
import { useRegisterBoardDnd } from "@/components/assignments/BoardDnd";
import { withTrackDetail, trackDetail } from "@/lib/eventTrackDetails";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabStrip } from "@/components/ui/TabStrip";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { IconBuilding, IconPlus, IconEdit, IconTrash } from "@/components/ui/Icons";
import { BuildingColumn, parseColumnDropId } from "@/components/tournament/buildings/BuildingColumn";
import { EventChip, parseEventDragId } from "@/components/tournament/buildings/EventChip";
import { BuildingFormModal } from "@/components/tournament/buildings/BuildingFormModal";

/** The event's display name — a catalog-linked event takes it from the joined
 *  canonical row, a custom one carries its own. */
function eventName(event: TournamentEvent): string {
  return event.name ?? event.event?.name ?? "Untitled event";
}

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
  const [pickedTrackId, setPickedTrackId] = useState<number | null>(null);
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
          border: "1px solid var(--color-accent)", background: "var(--color-surface)",
          boxShadow: "var(--shadow-lg)",
          fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
        }}>
          {eventName(event)}
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

  const unplaced = byBuilding.get(null) ?? [];

  function renderChips(list: TournamentEvent[], placed: boolean) {
    return list.map((event) => (
      <EventChip
        key={event.id}
        event={{ id: event.id, name: eventName(event), detail: trackDetail(event, activeTrackId!) }}
        locked={isArchived}
        placed={placed}
        onFloorChange={(floor) => patchDetail(event.id, { floor: floor.trim() || null })}
        onRoomsChange={(rooms) => patchDetail(event.id, { rooms })}
      />
    ));
  }

  return (
    <div>
      <PageHeader heading="Buildings" />

      {/* Hidden in simple mode: with one track every event's location is on
          it, so a one-tab strip would be furniture. */}
      {!isSimple && tracks.length > 0 && activeTrackId !== null && (
        <TabStrip
          tabs={tracks.map((t) => ({ key: String(t.id), label: t.name }))}
          activeKey={String(activeTrackId)}
          onChange={(key) => setPickedTrackId(Number(key))}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0, maxWidth: "62ch", lineHeight: 1.55 }}>
          Drag an event into a building to place it. Floors and rooms are free text — one building and one
          floor per event, but as many rooms as it spreads across.
        </p>
        <Button type="button" variant="primary" size="md" disabled={isArchived} onClick={() => setFormTarget("new")} style={{ flexShrink: 0 }}>
          <IconPlus size={14} /> Add building
        </Button>
      </div>

      {columns.length === 0 && unplaced.length === 0 ? (
        <EmptyState
          icon={<IconBuilding size={28} />}
          title="No buildings yet"
          description="Add the buildings this track runs in, then drag events into them."
        />
      ) : (
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", overflowX: "auto", paddingBottom: "8px" }}>
          <BuildingColumn
            buildingId={null}
            title="Unplaced"
            subtitle={`${unplaced.length} event${unplaced.length === 1 ? "" : "s"} with no building`}
            count={unplaced.length}
            tone="muted"
            emptyText="Everything on this track has a building."
          >
            {renderChips(unplaced, false)}
          </BuildingColumn>

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
                      <IconTrash />
                    </Button>
                  </div>
                )}
              >
                {renderChips(list, true)}
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
