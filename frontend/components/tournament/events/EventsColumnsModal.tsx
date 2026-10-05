"use client";

import { ColumnToggleModal } from "@/components/tournament/ColumnToggleModal";
import { EVENTS_TABLE } from "@/lib/displayConfigSurfaces";
import { DEFAULT_EVENT_COLUMNS, trackFamilyOf } from "@/components/tournament/events/eventColumns";

interface EventsColumnsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// What the event *is*, then one group per per-track field — families that
// grow with the schedule rather than a fixed set.
const FAMILY_GROUPS = [
  { family: "time", title: "Time" },
  { family: "shifts", title: "Shifts" },
  { family: "location", title: "Location" },
  { family: "staffing", title: "Staffing" },
] as const;

export function EventsColumnsModal({ tournamentId, onClose, onSaved }: EventsColumnsModalProps) {
  return (
    <ColumnToggleModal
      tournamentId={tournamentId}
      surface={EVENTS_TABLE}
      title="Configure table columns"
      defaultColumns={DEFAULT_EVENT_COLUMNS}
      selectColumns={(catalog) => catalog.event_columns}
      buildGroups={(columns) => {
        const families = FAMILY_GROUPS.map(({ family, title }) => ({
          title, items: columns.filter((c) => trackFamilyOf(c.key) === family),
        }));
        // A field with one track (a simple tournament) has nothing to pick
        // between, so it's a plain toggle named for the field, not the track.
        const single = families
          .filter((f) => f.items.length === 1)
          .map((f) => ({ ...f.items[0], label: f.title }));
        return [
          { title: "Event", items: [...columns.filter((c) => trackFamilyOf(c.key) === null), ...single] },
          ...families
            .filter((f) => f.items.length > 1)
            .map((f) => ({ ...f, layout: "chips" as const })),
        ];
      }}
      // A bare family key ("shifts") in the defaults and older saved configs
      // means every track's column; without expanding it they'd read as off.
      // The catalog already lists exactly the per-track keys each family has.
      expandKeys={(keys, columns) => keys.flatMap((key) => (
        FAMILY_GROUPS.some((g) => g.family === key)
          ? columns.filter((c) => trackFamilyOf(c.key) === key).map((c) => c.key)
          : [key]
      )).filter((key, i, all) => all.indexOf(key) === i)}
      onClose={onClose}
      onSaved={onSaved}
      width={560}
    />
  );
}
