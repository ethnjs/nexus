"use client";

import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { IconWarning, IconX } from "@/components/ui/Icons";
import { Tooltip } from "@/components/ui/Tooltip";
import type { TournamentEvent } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";

export interface EventChipFlag {
  level: "warning" | "error";
  detail: string;
}

const PREFIX = "room-event:";

export function roomChipDragId(roomId: number, eventId: number): string {
  return `${PREFIX}${roomId}:${eventId}`;
}

export function parseRoomChipDragId(id: string): { roomId: number; eventId: number } | null {
  if (!id.startsWith(PREFIX)) return null;
  const [roomId, eventId] = id.slice(PREFIX.length).split(":").map(Number);
  return Number.isFinite(roomId) && Number.isFinite(eventId) ? { roomId, eventId } : null;
}

const FLAG_STYLES = {
  none: { border: "var(--color-border)", background: "var(--color-accent-subtle)", icon: "" },
  warning: {
    border: "var(--color-warning)",
    background: "var(--color-warning-subtle)",
    icon: "var(--color-warning)",
  },
  error: {
    border: "var(--color-danger)",
    background: "var(--color-danger-subtle)",
    icon: "var(--color-danger)",
  },
} as const;

interface EventChipProps {
  event: TournamentEvent;
  roomId: number;
  /** An error outranks a warning for the chip's color; the tooltip lists all. */
  flags?: EventChipFlag[];
  locked: boolean;
  onOpen: (eventId: number) => void;
  onRemove: () => void;
}

/** An event placed in a room. Click opens it; drag moves it to another room. */
export function EventChip({ event, roomId, flags = [], locked, onOpen, onRemove }: EventChipProps) {
  const [removeHovered, setRemoveHovered] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: roomChipDragId(roomId, event.id),
    disabled: locked,
  });
  const level = flags.some((f) => f.level === "error")
    ? "error"
    : flags.length > 0
      ? "warning"
      : "none";
  const style = FLAG_STYLES[level];
  const name = eventNameWithDivision(event);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(event.id);
        } else if ((e.key === "Backspace" || e.key === "Delete") && !locked) {
          e.preventDefault();
          onRemove();
        }
      }}
      title={locked ? name : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        minWidth: 0,
        maxWidth: "100%",
        padding: locked ? "3px 10px" : "3px 6px 3px 10px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${style.border}`,
        background: style.background,
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        fontWeight: 500,
        color: "var(--color-text-primary)",
        cursor: locked ? "pointer" : "grab",
        opacity: isDragging ? 0.4 : 1,
        // dnd-kit makes the chip focusable; its drag state is the visual, so
        // the browser's focus ring only shows for keyboard focus.
        outline: "none",
      }}
    >
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </span>
      {flags.length > 0 && (
        <Tooltip
          variant={level === "error" ? "error" : "warning"}
          message={flags.map((f) => f.detail).join(" ")}
          showIcon={false}
        >
          <span style={{ display: "flex", color: style.icon }}>
            <IconWarning size={12} />
          </span>
        </Tooltip>
      )}
      {!locked && (
        // stopPropagation on pointerdown keeps the press from starting a drag.
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from this room"
          aria-label={`Remove ${name} from this room`}
          onPointerEnter={() => setRemoveHovered(true)}
          onPointerLeave={() => setRemoveHovered(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            padding: 0,
            width: "14px",
            height: "14px",
            border: "none",
            background: "transparent",
            borderRadius: "3px",
            color: "inherit",
            cursor: "pointer",
            // A darkening film, as on ChipInput's ×, so it reads on every flag color.
            boxShadow: removeHovered ? "inset 0 0 0 999px rgba(0,0,0,0.12)" : undefined,
            transition: "box-shadow 100ms ease",
          }}
        >
          <IconX size={10} />
        </button>
      )}
    </div>
  );
}
