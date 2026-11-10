"use client";

import { useDraggable } from "@dnd-kit/core";
import { type ReactNode, useState } from "react";
import { IconX } from "@/components/ui/Icons";

interface ZoneChipProps {
  /** Drags the chip to another zone, or back to the side panel to remove it. */
  dragId: string;
  label: string;
  /** Shown on hover over the chip. */
  title?: string;
  /** Before the label, e.g. a status dot. */
  icon?: ReactNode;
  /** After the label, e.g. a role menu. */
  trailing?: ReactNode;
  locked: boolean;
  onRemove: () => void;
}

/** A location or member in a zone. Styled like the buildings page's EventChip. */
export function ZoneChip({
  dragId,
  label,
  title,
  icon,
  trailing,
  locked,
  onRemove,
}: ZoneChipProps) {
  const [removeHovered, setRemoveHovered] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    disabled: locked,
  });

  return (
    // Stops a click reaching the tag field, which would focus its search.
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => e.stopPropagation()}
      title={title ?? label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        minWidth: 0,
        maxWidth: "100%",
        padding: locked ? "3px 10px" : "3px 6px 3px 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border)",
        background: "var(--color-accent-subtle)",
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        fontWeight: 500,
        color: "var(--color-text-primary)",
        cursor: locked ? "default" : "grab",
        opacity: isDragging ? 0.4 : 1,
        outline: "none",
      }}
    >
      {icon}
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      {trailing}
      {!locked && (
        <button
          type="button"
          tabIndex={-1}
          // Keeps a press on the x from starting a drag.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          title="Remove from this zone"
          aria-label={`Remove ${label} from this zone`}
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
