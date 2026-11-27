"use client";

import { ColumnToggleModal } from "@/components/tournament/ColumnToggleModal";
import {
  AVAILABILITY_TRACK_PREFIX,
  EVENT_PREF_PREFIX,
  FIELD_KEY_PREFIX,
  LUNCH_PREFIX,
  soleTrackColumnLabel,
  TRACK_PREFIX,
} from "@/components/tournament/members/memberColumns";
import type { DisplayConfigCatalogItem } from "@/lib/api";
import { MEMBERS_TABLE } from "@/lib/displayConfigSurfaces";
import { useTournament } from "@/lib/useTournament";

// A profile field, but it's what a lunch planner reads beside the lunch picks,
// so the modal files it under Lunch rather than Member.
const DIETARY = "dietary_restriction";

// Mirrors the backend's DEFAULT_COLUMNS — what a tournament with nothing
// saved shows, and therefore what the toggles start from.
const DEFAULT_COLUMNS = ["email", "phone", "account_age", "joined", "method"];

interface TableColumnsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Column order follows the catalog (fixed columns first, then one per track /
// availability day / lunch category / event preference / custom field), so
// turning a column on puts it where a TD would expect rather than at the end.
// The per-track kinds are chips: a dozen tracks is a dozen near-identical
// toggles otherwise.
export function TableColumnsModal({ tournamentId, onClose, onSaved }: TableColumnsModalProps) {
  const { isSimple } = useTournament();
  // With one track each per-track group holds one column, so those become
  // plain Member toggles named like their header, as on the events picker.
  const named = (items: DisplayConfigCatalogItem[]) =>
    isSimple ? items.map((c) => ({ ...c, label: soleTrackColumnLabel(c.key) ?? c.label })) : items;
  const perTrack = (items: DisplayConfigCatalogItem[]) => (isSimple ? [] : items);
  return (
    <ColumnToggleModal
      tournamentId={tournamentId}
      surface={MEMBERS_TABLE}
      title="Configure table columns"
      defaultColumns={DEFAULT_COLUMNS}
      selectColumns={(catalog) => catalog.columns}
      buildGroups={(columns) => [
        {
          title: "Member",
          items: [
            ...columns.filter((c) => !c.key.includes(":") && c.key !== DIETARY),
            ...(isSimple
              ? named(
                  columns.filter((c) =>
                    [TRACK_PREFIX, AVAILABILITY_TRACK_PREFIX, EVENT_PREF_PREFIX].some((prefix) =>
                      c.key.startsWith(prefix),
                    ),
                  ),
                )
              : []),
          ],
        },
        {
          title: "Track status",
          items: perTrack(columns.filter((c) => c.key.startsWith(TRACK_PREFIX))),
          layout: "chips",
        },
        {
          title: "Availability",
          items: perTrack(columns.filter((c) => c.key.startsWith(AVAILABILITY_TRACK_PREFIX))),
          layout: "chips",
        },
        {
          title: "Lunch",
          items: [
            ...columns.filter((c) => c.key === DIETARY),
            ...named(columns.filter((c) => c.key.startsWith(LUNCH_PREFIX))),
          ],
          layout: "chips",
        },
        {
          title: "Event preferences",
          items: perTrack(columns.filter((c) => c.key.startsWith(EVENT_PREF_PREFIX))),
          layout: "chips",
        },
        {
          title: "Custom fields",
          items: columns.filter((c) => c.key.startsWith(FIELD_KEY_PREFIX)),
        },
      ]}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
