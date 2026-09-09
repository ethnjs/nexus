"use client";

import {
  AVAILABILITY_TRACK_PREFIX, FORM_FIELD_PREFIX, LUNCH_PREFIX, TRACK_PREFIX,
} from "@/components/tournament/memberColumns";
import { ColumnToggleModal } from "@/components/tournament/ColumnToggleModal";
import { MEMBERS_TABLE } from "@/lib/displayConfigSurfaces";

// Mirrors the backend's DEFAULT_COLUMNS — what a tournament with nothing
// saved shows, and therefore what the toggles start from.
const DEFAULT_COLUMNS = ["email", "phone", "account_age", "joined", "method"];

interface TableColumnsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Column order follows the catalog (fixed columns first, then one per track /
// availability day / lunch category / custom field), so turning a column on
// puts it where a TD would expect rather than at the end.
export function TableColumnsModal({ tournamentId, onClose, onSaved }: TableColumnsModalProps) {
  return (
    <ColumnToggleModal
      tournamentId={tournamentId}
      surface={MEMBERS_TABLE}
      title="Configure table columns"
      defaultColumns={DEFAULT_COLUMNS}
      selectColumns={(catalog) => catalog.columns}
      buildGroups={(columns) => [
        { title: "Member", items: columns.filter((c) => !c.key.includes(":")) },
        { title: "Tracks", items: columns.filter((c) => c.key.startsWith(TRACK_PREFIX)) },
        { title: "Availability", items: columns.filter((c) => c.key.startsWith(AVAILABILITY_TRACK_PREFIX)) },
        { title: "Lunch", items: columns.filter((c) => c.key.startsWith(LUNCH_PREFIX)) },
        { title: "Custom fields", items: columns.filter((c) => c.key.startsWith(FORM_FIELD_PREFIX)) },
      ]}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
