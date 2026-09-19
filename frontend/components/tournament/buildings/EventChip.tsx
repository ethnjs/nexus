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
  event, locked, placed, onFloorChange, onRoomsChange, onRemove, onOpen, selected,
}: {
  /** Click on the header opens the event's edit panel. A drag never fires it:
   *  the sensor's 4px threshold separates the two. */
  onOpen?: () => void;
  /** This chip's event is the one open in the panel. */
  selected?: boolean;
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
        border: `1px solid ${selected ? "var(--color-border-strong)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
        boxShadow: selected ? "0 0 0 3px var(--color-accent-subtle)" : "none",
        // Left in place at low opacity rather than removed: the columns would
        // otherwise reflow mid-drag and the drop target move out from under
        // the cursor.
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        onClick={onOpen}
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px",
          cursor: locked ? "pointer" : "grab",
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
          // Both stops: pointerdown so it doesn't start a drag, click so it
          // doesn't also open the panel.
          <span
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: "auto", display: "flex" }}
          >
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
        // Side by side like the events panel: flex-wrap with a basis and grow
        // per field, so a narrow column wraps them instead of squeezing.
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "8px", padding: "0 10px 10px" }}>
          <div style={{ flex: "0.5 1 56px", minWidth: 0 }}>
            <Input
              size="xs"
              fullWidth
              font="mono"
              locked={locked}
              label="Floor"
              placeholder="e.g. 2"
              value={event.detail?.floor ?? ""}
              onChange={(e) => onFloorChange(e.target.value)}
            />
          </div>
          {/* Many rooms, one building and one floor — an event routinely
              spreads across 210, 212 and 214. */}
          <div style={{ flex: "1.6 1 110px", minWidth: 0 }}>
            <ChipInput
              size="xs"
              fullWidth
              locked={locked}
              label="Rooms"
              placeholder="Add a room"
              value={event.detail?.rooms ?? []}
              onChange={onRoomsChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
