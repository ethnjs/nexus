"use client";

import { ColumnToggleModal } from "@/components/tournament/ColumnToggleModal";
import { EVENTS_TABLE } from "@/lib/displayConfigSurfaces";
import { DEFAULT_EVENT_COLUMNS, LOCATION_COLUMN_KEYS } from "@/components/tournament/events/eventColumns";

interface EventsColumnsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Two groups rather than one flat list: the first five describe what the
// event *is*, the rest are the day-of logistics that stay blank through most
// of planning — a TD turning those on is doing a different job.
export function EventsColumnsModal({ tournamentId, onClose, onSaved }: EventsColumnsModalProps) {
  return (
    <ColumnToggleModal
      tournamentId={tournamentId}
      surface={EVENTS_TABLE}
      title="Configure table columns"
      defaultColumns={DEFAULT_EVENT_COLUMNS}
      selectColumns={(catalog) => catalog.event_columns}
      buildGroups={(columns) => [
        { title: "Event", items: columns.filter((c) => !LOCATION_COLUMN_KEYS.has(c.key)) },
        { title: "Logistics", items: columns.filter((c) => LOCATION_COLUMN_KEYS.has(c.key)) },
      ]}
      onClose={onClose}
      onSaved={onSaved}
      width={560}
    />
  );
}
