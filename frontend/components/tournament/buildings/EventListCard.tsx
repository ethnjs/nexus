"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { memo, type ReactNode } from "react";
import { parseRoomChipDragId } from "@/components/tournament/buildings/EventChip";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { IconBuilding, IconCalendar, IconClock } from "@/components/ui/Icons";
import { EVENT_FORMAT_LABELS, type TournamentEvent } from "@/lib/api";
import { eventNameWithDivision, trackLocationLabel } from "@/lib/eventDisplay";
import { trackDetail } from "@/lib/eventTrackDetails";
import { formatDayLabel, formatTimeRange, toDateInput } from "@/lib/timeFormat";

/** The details a card can show besides name and division, which always show. */
export const EVENT_CARD_FIELDS = [
  { id: "type", label: "Type" },
  { id: "format", label: "Format" },
  { id: "category", label: "Category" },
  { id: "impound", label: "Impound" },
  { id: "self_schedule", label: "Self-schedule" },
  { id: "shifts", label: "Date, time and shifts" },
] as const;
export type EventCardField = (typeof EVENT_CARD_FIELDS)[number]["id"];

export const EVENT_FIELD_PREFIX = "event_field:";

export function eventDragId(eventId: number): string {
  return `building-event:${eventId}`;
}

export function parseEventDragId(id: string): number | null {
  if (!id.startsWith("building-event:")) return null;
  const parsed = Number(id.slice("building-event:".length));
  return Number.isFinite(parsed) ? parsed : null;
}

interface EventListCardProps {
  event: TournamentEvent;
  trackId: number;
  hidden: ReadonlySet<EventCardField>;
  selected: boolean;
  locked: boolean;
  onOpen: (eventId: number) => void;
  /** Beside the name, e.g. the zone the event is in. */
  aside?: ReactNode;
}

const META_TEXT = {
  display: "flex",
  alignItems: "center",
  gap: "5px",
  fontFamily: "var(--font-sans)",
  fontSize: "12px",
  color: "var(--color-text-secondary)",
} as const;

export const EventListCard = memo(function EventListCard({
  event,
  trackId,
  hidden,
  selected,
  locked,
  onOpen,
  aside,
}: EventListCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: eventDragId(event.id),
    disabled: locked,
  });
  const shows = (field: EventCardField) => !hidden.has(field);
  const location = trackLocationLabel(trackDetail(event, trackId));
  const shifts = (event.shifts ?? [])
    .filter((s) => s.track_id === trackId)
    .sort((a, b) => a.start.localeCompare(b.start));
  const days = [...new Set(shifts.map((s) => toDateInput(s.start)))];
  const badges = [
    shows("type") && event.event_type === "trial" && "Trial",
    shows("format") && event.format && EVENT_FORMAT_LABELS[event.format],
    shows("impound") && event.has_impound && "Impound",
    shows("self_schedule") && event.has_self_schedule && "Self-schedule",
  ].filter((b): b is string => !!b);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(event.id)}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: locked ? "pointer" : "grab" }}
    >
      <Card
        hoverable
        borderColor={selected ? "var(--color-border-strong)" : undefined}
        style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "4px" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {eventNameWithDivision(event)}
          </span>
          {aside}
        </span>
        <span
          style={{
            ...META_TEXT,
            color: location ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
          }}
        >
          <IconBuilding size={12} />
          {location ?? "Unplaced"}
        </span>
        {shows("shifts") && shifts.length > 0 && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
            <span style={META_TEXT}>
              <IconCalendar size={12} />
              {days.map(formatDayLabel).join(", ")}
            </span>
            <span style={META_TEXT}>
              <IconClock size={12} />
              {formatTimeRange(shifts)}
            </span>
          </span>
        )}
        {shows("category") && event.event && (
          <span style={META_TEXT}>{event.event.category.name}</span>
        )}
        {shows("shifts") && shifts.length > 0 && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {shifts.map((s) => (
              <Badge key={s.id}>{s.label}</Badge>
            ))}
          </span>
        )}
        {badges.length > 0 && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {badges.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </span>
        )}
      </Card>
    </div>
  );
});

export const EVENT_LIST_DROP_ID = "building-event-list";

/** The docked list, where a chip dragged out of a room is dropped to take it
 *  out of that room. Only lights up for a room chip, since a list card
 *  dropped back on its own list does nothing. */
export function EventListDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: EVENT_LIST_DROP_ID });
  const fromRoom = isOver && !!active && parseRoomChipDragId(String(active.id)) !== null;
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: "100%",
        background: fromRoom ? "var(--color-accent-subtle)" : undefined,
        boxShadow: fromRoom ? "inset 0 0 0 1px var(--color-border-strong)" : undefined,
        transition: "background 100ms ease",
      }}
    >
      {children}
    </div>
  );
}
