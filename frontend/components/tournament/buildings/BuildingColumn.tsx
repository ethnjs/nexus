"use client";

import { type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";

/** The droppable id for one column. `null` is the unplaced rail — an event
 *  dropped there has its building, floor and rooms cleared. */
export function columnDropId(buildingId: number | null): string {
  return buildingId === null ? "building-col:none" : `building-col:${buildingId}`;
}

export function parseColumnDropId(id: string): { buildingId: number | null } | null {
  if (!id.startsWith("building-col:")) return null;
  const rest = id.slice("building-col:".length);
  if (rest === "none") return { buildingId: null };
  const parsed = Number(rest);
  return Number.isFinite(parsed) ? { buildingId: parsed } : null;
}

/**
 * One column of the board: a building, or the unplaced rail.
 *
 * The rail is the same component rather than a special case — it is a place
 * an event can be, and "nowhere yet" needs to accept a drop exactly as a
 * building does. Only its styling says it is different.
 */
export function BuildingColumn({
  buildingId, title, subtitle, count, tone = "normal", actions, children, emptyText,
}: {
  buildingId: number | null;
  title: string;
  subtitle?: string;
  count: number;
  /** "muted" is the unplaced rail — present, but not somewhere to aim for. */
  tone?: "normal" | "muted";
  actions?: ReactNode;
  children: ReactNode;
  emptyText: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(buildingId) });

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex", flexDirection: "column", gap: "8px",
        flex: "0 0 260px", minWidth: 0, padding: "12px",
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${isOver ? "var(--color-border-strong)" : "var(--color-border)"}`,
        background: tone === "muted" ? "var(--color-bg)" : "var(--color-surface)",
        // The whole column lifts on hover-over, not just the gap between
        // chips: the drop lands on the column wherever inside it you release.
        boxShadow: isOver ? "0 0 0 3px var(--color-accent-subtle)" : "none",
        transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600,
            color: "var(--color-text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {title}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            {subtitle ?? `${count} event${count === 1 ? "" : "s"}`}
          </div>
        </div>
        {actions}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minHeight: "48px" }}>
        {count === 0 ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "16px 8px", borderRadius: "var(--radius-md)",
            border: "1px dashed var(--color-border)",
            fontFamily: "var(--font-sans)", fontSize: "12px",
            color: "var(--color-text-tertiary)", textAlign: "center",
          }}>
            {emptyText}
          </div>
        ) : children}
      </div>
    </div>
  );
}
