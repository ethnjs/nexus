"use client";

import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconPlus } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import type { TournamentEvent } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";

interface RoomEventsCellProps {
  /** The events in this room, in display order. */
  events: TournamentEvent[];
  /** Every other event on the day, with where it is now ("Rowland 210"), if anywhere. */
  candidates: { event: TournamentEvent; location: string | null }[];
  locked: boolean;
  onAdd: (event: TournamentEvent) => Promise<void>;
  onRemove: (event: TournamentEvent) => Promise<void>;
}

export function RoomEventsCell({
  events,
  candidates,
  locked,
  onAdd,
  onRemove,
}: RoomEventsCellProps) {
  const byLabel = new Map(events.map((e) => [eventNameWithDivision(e), e]));

  return (
    <ChipInput
      value={[...byLabel.keys()]}
      onChange={(labels) => {
        const removed = [...byLabel].find(([label]) => !labels.includes(label));
        if (removed) void onRemove(removed[1]);
      }}
      disableInput
      locked={locked}
      variant="transparent"
      size="sm"
      fullWidth
      addButton={
        <Popover
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              iconOnly
              title="Add event"
              data-add-event
              style={{ flexShrink: 0 }}
            >
              <IconPlus size={12} />
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
      }
    />
  );
}
