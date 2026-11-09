"use client";

import { EventChip, type EventChipFlag } from "@/components/tournament/buildings/EventChip";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import table from "@/components/ui/Table.module.css";
import type { TournamentEvent } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";

interface RoomEventsCellProps {
  roomId: number;
  /** The events in this room, in display order. */
  events: TournamentEvent[];
  flagsFor?: (event: TournamentEvent) => EventChipFlag[];
  /** Every other event on the day, with where it is now ("Rowland 210"), if anywhere. */
  candidates: { event: TournamentEvent; location: string | null }[];
  locked: boolean;
  onAdd: (event: TournamentEvent) => Promise<void>;
  onRemove: (event: TournamentEvent) => Promise<void>;
  onOpen: (eventId: number) => void;
}

export function RoomEventsCell({
  roomId,
  events,
  flagsFor,
  candidates,
  locked,
  onAdd,
  onRemove,
  onOpen,
}: RoomEventsCellProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
      {events.length === 0 && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-tertiary)",
          }}
        >
          None
        </span>
      )}
      {events.map((event) => (
        <EventChip
          key={event.id}
          event={event}
          roomId={roomId}
          flags={flagsFor?.(event)}
          locked={locked}
          onOpen={onOpen}
          onRemove={() => void onRemove(event)}
        />
      ))}
      {!locked && (
        <span className={table.revealOnHover}>
          <Popover
            trigger={
              // Same as the roster's Roles cell add button.
              <Button
                type="button"
                variant="secondary"
                size="sm"
                iconOnly
                title="Add event"
                data-add-event
                style={{ padding: 0, flexShrink: 0 }}
              >
                <IconPlus size={14} />
              </Button>
            }
            items={candidates}
            getKey={({ event }) => event.id}
            renderLabel={({ event, location }) => (
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>{eventNameWithDivision(event)}</span>
                {location && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    {location}
                  </span>
                )}
              </span>
            )}
            searchable
            getSearchText={({ event }) => eventNameWithDivision(event)}
            onSelect={({ event }) => onAdd(event)}
            emptyMessage="No other events on this day"
            align="left"
            width={220}
          />
        </span>
      )}
    </div>
  );
}
