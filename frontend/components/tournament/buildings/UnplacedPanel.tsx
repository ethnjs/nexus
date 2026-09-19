"use client";

import { type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { FilterButton } from "@/components/ui/FilterButton";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBuilding, IconSearch } from "@/components/ui/Icons";
import { columnDropId } from "@/components/tournament/buildings/BuildingColumn";
import table from "@/components/ui/Table.module.css";

export const UNPLACED_PANEL_WIDTH = 320;

/**
 * The rail of events with no building on the active track, docked beside the
 * board the way the assignments page docks its members.
 *
 * The whole panel body is the drop target for "no building" — dragging a chip
 * back here clears its building, floor and rooms, same as the old column did.
 */
export function UnplacedPanel({
  query, onQueryChange, filterActive, onOpenFilter, onClearFilters,
  shown, total, locked, children,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filterActive: boolean;
  onOpenFilter: () => void;
  onClearFilters: () => void;
  /** Chips that pass the search and filter, and how many there are before them. */
  shown: number;
  total: number;
  locked: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(null), disabled: locked });
  const narrowed = query.trim() !== "" || filterActive;

  return (
    <DockedPanel
      width={UNPLACED_PANEL_WIDTH}
      headerActions={
        <FilterButton
          size="sm" iconOnly label="Filter events"
          active={filterActive}
          onOpen={onOpenFilter}
          onClear={onClearFilters}
        />
      }
    >
      <div
        ref={setNodeRef}
        style={{
          padding: "12px", display: "flex", flexDirection: "column", gap: "10px",
          minHeight: "100%", boxSizing: "border-box",
          background: isOver ? "var(--color-accent-subtle)" : "transparent",
          transition: "background var(--transition-fast)",
        }}
      >
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onClear={() => onQueryChange("")}
          placeholder="Search events"
          icon={<IconSearch />}
          size="md"
          variant="secondary"
          font="sans"
          fullWidth
        />
        <span className={table.headerLabel}>Unplaced — {shown}/{total}</span>

        {shown === 0 ? (
          <EmptyState
            icon={<IconBuilding size={24} />}
            title={narrowed ? "No events match" : "All placed"}
            description={narrowed ? "Try a wider filter." : "Everything on this track has a building."}
            action={narrowed ? (
              <Button size="sm" variant="secondary" onClick={() => { onQueryChange(""); onClearFilters() }}>
                Clear filters
              </Button>
            ) : undefined}
          />
        ) : children}
      </div>
    </DockedPanel>
  );
}
