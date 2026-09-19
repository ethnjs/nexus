"use client";

import { useDraggable } from "@dnd-kit/core";
import type { EventTrackDetailRead } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconGripVertical, IconTrash } from "@/components/ui/Icons";

/** The draggable id for one event chip. Parsed back out in the drop handler,
 *  so the two spellings live next to each other. */
export function eventDragId(eventId: number): string {
  return `building-event:${eventId}`;
}

export function parseEventDragId(id: string): number | null {
  if (!id.startsWith("building-event:")) return null;
  const parsed = Number(id.slice("building-event:".length));
  return Number.isFinite(parsed) ? parsed : null;
}

export interface EventChipData {
  id: number;
  name: string;
  detail: EventTrackDetailRead | undefined;
}

/**
 * One event on the buildings board.
 *
 * Only the header is a drag handle. Putting the listeners on the whole chip
 * would swallow pointerdown on the floor field and the room chips — the
 * PointerSensor's 4px threshold stops a click becoming a drag, but the input
 * never receives focus because dnd-kit has already claimed the event.
 */
export function EventChip({
  event, locked, placed, onFloorChange, onRoomsChange, onRemove,
}: {
  /** Placed chips only: clears the building and sends the event back to the
   *  unplaced panel — the click twin of dragging it there. */
  onRemove?: () => void;
  event: EventChipData;
  locked: boolean;
  /** Unplaced chips show the name only — there is no building for a floor or
   *  a room to be a floor or room *of*. */
  placed: boolean;
  onFloorChange: (floor: string) => void;
  onRoomsChange: (rooms: string[]) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: eventDragId(event.id),
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
        // Left in place at low opacity rather than removed: the columns would
        // otherwise reflow mid-drag and the drop target move out from under
        // the cursor.
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px",
          cursor: locked ? "default" : "grab",
          fontFamily: "var(--font-sans)", fontSize: "13px",
          color: "var(--color-text-primary)",
        }}
      >
        {!locked && (
          <span style={{ color: "var(--color-text-tertiary)", display: "flex" }}>
            <IconGripVertical />
          </span>
        )}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {event.name}
        </span>
        {placed && onRemove && !locked && (
          // stopPropagation so pressing it doesn't start a drag of the chip.
          <span onPointerDown={(e) => e.stopPropagation()} style={{ marginLeft: "auto", display: "flex" }}>
            <Button
              type="button" variant="ghost" size="xs" iconOnly
              onClick={onRemove}
              title="Move back to unplaced"
              aria-label={`Remove ${event.name} from its building`}
            >
              <IconTrash style={{ color: "var(--color-danger)" }} />
            </Button>
          </span>
        )}
      </div>

      {placed && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "0 10px 10px" }}>
          <Input
            size="xs"
            fullWidth
            font="mono"
            locked={locked}
            placeholder="Floor"
            value={event.detail?.floor ?? ""}
            onChange={(e) => onFloorChange(e.target.value)}
          />
          {/* Many rooms, one building and one floor — an event routinely
              spreads across 210, 212 and 214. */}
          <ChipInput
            size="xs"
            variant="transparent"
            fullWidth
            locked={locked}
            placeholder="Add a room"
            value={event.detail?.rooms ?? []}
            onChange={onRoomsChange}
          />
        </div>
      )}
    </div>
  );
}
