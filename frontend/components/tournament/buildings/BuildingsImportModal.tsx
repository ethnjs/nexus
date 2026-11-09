"use client";

import { useState } from "react";
import { RoomAssignmentsImport } from "@/components/tournament/buildings/RoomAssignmentsImport";
import { RoomsImport } from "@/components/tournament/buildings/RoomsImport";
import { Modal } from "@/components/ui/Modal";
import { TabStrip } from "@/components/ui/TabStrip";
import type { TournamentBuilding, TournamentEvent, TournamentTrack } from "@/lib/api";

type ImportTab = "rooms" | "assignments";

/** The buildings page's import: rooms, or events' room assignments. */
export function BuildingsImportModal({
  tournamentId,
  track,
  trackIds,
  buildings,
  events,
  onClose,
  onImported,
}: {
  tournamentId: number;
  /** The selected track tab, which room assignments apply to. */
  track: TournamentTrack;
  /** Every competition day — a new building starts on all of them. */
  trackIds: number[];
  /** Every building in the tournament, on any day. */
  buildings: TournamentBuilding[];
  /** The events on `track`. */
  events: readonly TournamentEvent[];
  onClose: () => void;
  /** Called with what changed, even when a later request fails. */
  onImported: (buildings: TournamentBuilding[], events: TournamentEvent[]) => void;
}) {
  const [tab, setTab] = useState<ImportTab>("rooms");

  return (
    <Modal title="Import buildings" onClose={onClose} width={680}>
      <TabStrip<ImportTab>
        tabs={[
          { key: "rooms", label: "Rooms" },
          { key: "assignments", label: "Room assignments" },
        ]}
        activeKey={tab}
        onChange={setTab}
      />
      {tab === "rooms" ? (
        <RoomsImport
          tournamentId={tournamentId}
          trackIds={trackIds}
          buildings={buildings}
          onCancel={onClose}
          onDone={onClose}
          onImported={(saved) => onImported(saved, [])}
        />
      ) : (
        <RoomAssignmentsImport
          tournamentId={tournamentId}
          track={track}
          dayTrackIds={trackIds}
          events={events}
          buildings={buildings}
          onCancel={onClose}
          onDone={onClose}
          onImported={onImported}
        />
      )}
    </Modal>
  );
}
