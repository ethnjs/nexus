"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { type ReactNode, useMemo, useState } from "react";
import { EventListCard } from "@/components/tournament/buildings/EventListCard";
import {
  parseZoneDragId,
  ZONE_PANEL_DROP_ID,
  zoneDragId,
} from "@/components/tournament/zones/zoneDnd";
import { Card } from "@/components/ui/Card";
import { IconChevronDown, IconChevronRight, IconSearch } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import table from "@/components/ui/Table.module.css";
import type { TournamentBuilding, TournamentEvent, TournamentRoom, Zone } from "@/lib/api";
import { buildingLabel } from "@/lib/buildings";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { roomFloor } from "@/lib/eventTrackDetails";
import { ruleKey, type ZoneTarget } from "@/lib/zones";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NO_HIDDEN_FIELDS = new Set<never>();

/** The side panel's body: a chip dragged off a zone card and dropped here leaves its zone. */
export function ZonePanelDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: ZONE_PANEL_DROP_ID });
  const drag = active ? parseZoneDragId(String(active.id)) : null;
  const removing = isOver && (drag?.kind === "rule-chip" || drag?.kind === "member-chip");
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: "100%",
        background: removing ? "var(--color-accent-subtle)" : undefined,
        boxShadow: removing ? "inset 0 0 0 1px var(--color-border-strong)" : undefined,
        transition: "background 100ms ease",
      }}
    >
      {children}
    </div>
  );
}

interface ZoneLocationsListProps {
  trackId: number;
  buildings: TournamentBuilding[];
  events: TournamentEvent[];
  targets: ZoneTarget[];
  zones: Zone[];
  owners: Map<string, Zone>;
  focusedEventId: number | null;
  locked: boolean;
  onOpenEvent: (eventId: number) => void;
}

/** The day's buildings (a card each, with its floors and rooms) and events, to drag onto zones. */
export function ZoneLocationsList({
  trackId,
  buildings,
  events,
  targets,
  zones,
  owners,
  focusedEventId,
  locked,
  onOpenEvent,
}: ZoneLocationsListProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const needle = query.trim().toLowerCase();

  const eventZone = useMemo(() => {
    const byEvent = new Map<number, string>();
    for (const zone of zones) for (const id of zone.event_ids) byEvent.set(id, zone.name);
    return byEvent;
  }, [zones]);

  /** The zone a room falls in: its own rule, else its floor's, else its building's. */
  const roomZone = (building: TournamentBuilding, room: TournamentRoom) => {
    const floor = roomFloor(room);
    return (
      owners.get(`room:${room.id}`) ??
      (floor ? owners.get(`floor:${building.id}:${floor}`) : undefined) ??
      owners.get(`building:${building.id}`)
    )?.name;
  };
  const floorZone = (building: TournamentBuilding, floor: string) =>
    (owners.get(`floor:${building.id}:${floor}`) ?? owners.get(`building:${building.id}`))?.name;

  // A search matches a building, floor or room by the same text the card
  // picker uses; a building shows when it or anything in it matches.
  const matchingKeys = useMemo(
    () =>
      needle
        ? new Set(
            targets
              .filter((t) => t.searchText.toLowerCase().includes(needle))
              .map((t) => ruleKey(t.rule)),
          )
        : null,
    [targets, needle],
  );
  const shows = (key: string) => !matchingKeys || matchingKeys.has(key);

  const sortedBuildings = [...buildings].sort((a, b) => collator.compare(a.name, b.name));
  const listedEvents = events
    .filter((e) => !needle || eventNameWithDivision(e).toLowerCase().includes(needle))
    .sort((a, b) => collator.compare(eventNameWithDivision(a), eventNameWithDivision(b)));

  function toggle(buildingId: number) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(buildingId)) next.delete(buildingId);
      else next.add(buildingId);
      return next;
    });
  }

  const buildingCards = sortedBuildings.flatMap((building) => {
    const floors = [...new Set(building.rooms.map(roomFloor).filter((f): f is string => !!f))].sort(
      collator.compare,
    );
    const loose = building.rooms.filter((r) => !roomFloor(r));
    const roomShown = (room: TournamentRoom) => shows(`room:${room.id}`);
    const floorShown = (floor: string) =>
      shows(`floor:${building.id}:${floor}`) ||
      building.rooms.some((r) => roomFloor(r) === floor && roomShown(r));
    const anyShown =
      shows(`building:${building.id}`) || floors.some(floorShown) || loose.some(roomShown);
    if (!anyShown) return [];
    // A search opens every building so its matches are visible.
    const open = needle ? true : !collapsed.has(building.id);

    const roomRow = (room: TournamentRoom, depth: number) =>
      (needle ? roomShown(room) : true) && (
        <DragRow
          key={room.id}
          depth={depth}
          dragId={zoneDragId({ kind: "target", ruleKey: `room:${room.id}` })}
          label={`${buildingLabel(building)} ${room.name}`}
          zone={roomZone(building, room)}
          locked={locked}
        />
      );

    return [
      <Card key={building.id} style={{ padding: "4px" }}>
        <DragRow
          dragId={zoneDragId({ kind: "target", ruleKey: `building:${building.id}` })}
          label={building.name}
          strong
          zone={owners.get(`building:${building.id}`)?.name}
          locked={locked}
          toggle={
            building.rooms.length > 0 && !needle
              ? { open, onToggle: () => toggle(building.id) }
              : undefined
          }
        />
        {open &&
          floors
            .filter((floor) => !needle || floorShown(floor))
            .map((floor) => (
              <div key={floor}>
                <DragRow
                  depth={1}
                  dragId={zoneDragId({
                    kind: "target",
                    ruleKey: `floor:${building.id}:${floor}`,
                  })}
                  label={`Floor ${floor}`}
                  zone={floorZone(building, floor)}
                  locked={locked}
                />
                {building.rooms.filter((r) => roomFloor(r) === floor).map((r) => roomRow(r, 2))}
              </div>
            ))}
        {open && loose.map((r) => roomRow(r, 1))}
      </Card>,
    ];
  });

  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        placeholder="Search locations"
        icon={<IconSearch />}
        size="md"
        variant="secondary"
        font="sans"
        fullWidth
      />
      <span className={table.headerLabel}>Buildings</span>
      {buildingCards.length === 0 ? (
        <Empty>{needle ? "No buildings match" : "No buildings on this day"}</Empty>
      ) : (
        buildingCards
      )}
      <span className={table.headerLabel}>
        Events — {listedEvents.length}/{events.length}
      </span>
      {listedEvents.length === 0 ? (
        <Empty>{needle ? "No events match" : "No events on this day"}</Empty>
      ) : (
        listedEvents.map((event) => (
          <EventListCard
            key={event.id}
            event={event}
            trackId={trackId}
            hidden={NO_HIDDEN_FIELDS}
            selected={event.id === focusedEventId}
            locked={locked}
            onOpen={onOpenEvent}
            aside={eventZone.has(event.id) && <ZoneTag name={eventZone.get(event.id) ?? ""} />}
          />
        ))
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
        color: "var(--color-text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

function ZoneTag({ name }: { name: string }) {
  return (
    <span
      title={`In ${name}`}
      style={{
        flexShrink: 0,
        maxWidth: "45%",
        padding: "1px 6px",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-accent-subtle)",
        fontFamily: "var(--font-sans)",
        fontSize: "11px",
        fontWeight: 400,
        color: "var(--color-text-secondary)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {name}
    </span>
  );
}

function DragRow({
  dragId,
  label,
  zone,
  strong = false,
  depth = 0,
  locked,
  toggle,
}: {
  dragId: string;
  label: string;
  /** The zone it's in, if any. */
  zone?: string;
  strong?: boolean;
  depth?: number;
  locked: boolean;
  toggle?: { open: boolean; onToggle: () => void };
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    disabled: locked,
  });
  const [hovered, setHovered] = useState(false);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 8px",
        paddingLeft: `${8 + depth * 16}px`,
        borderRadius: "var(--radius-sm)",
        background: hovered && !locked ? "var(--color-bg)" : undefined,
        fontFamily: "var(--font-sans)",
        fontSize: strong ? "14px" : "13px",
        fontWeight: strong ? 500 : 400,
        color: "var(--color-text-primary)",
        cursor: locked ? "default" : "grab",
        opacity: isDragging ? 0.4 : 1,
        outline: "none",
      }}
    >
      {toggle && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggle.onToggle();
          }}
          aria-label={toggle.open ? `Collapse ${label}` : `Expand ${label}`}
          style={{
            display: "flex",
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          {toggle.open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      {zone && <ZoneTag name={zone} />}
    </div>
  );
}
