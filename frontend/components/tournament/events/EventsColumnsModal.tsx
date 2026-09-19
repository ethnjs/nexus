"use client";

import { ColumnToggleModal } from "@/components/tournament/ColumnToggleModal";
import { EVENTS_TABLE } from "@/lib/displayConfigSurfaces";
import { DEFAULT_EVENT_COLUMNS, expandShiftColumns } from "@/components/tournament/events/eventColumns";

const isShiftColumn = (key: string) => key.startsWith("shifts:");

interface EventsColumnsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Two groups: what the event *is*, then one shift column per competition
// track — a family that grows with the schedule rather than a fixed set.
export function EventsColumnsModal({ tournamentId, onClose, onSaved }: EventsColumnsModalProps) {
  return (
    <ColumnToggleModal
      tournamentId={tournamentId}
      surface={EVENTS_TABLE}
      title="Configure table columns"
      defaultColumns={DEFAULT_EVENT_COLUMNS}
      selectColumns={(catalog) => catalog.event_columns}
      buildGroups={(columns) => [
        { title: "Event", items: columns.filter((c) => !isShiftColumn(c.key)) },
        { title: "Shifts", items: columns.filter((c) => isShiftColumn(c.key)) },
      ]}
      // The bare "shifts" in the defaults and older saved configs means every
      // track's column; without expanding it they would all read as off.
      expandKeys={(keys, columns) => expandShiftColumns(
        keys,
        columns.filter((c) => isShiftColumn(c.key)).map((c) => Number(c.key.slice("shifts:".length))),
      )}
      onClose={onClose}
      onSaved={onSaved}
      width={560}
    />
  );
}
