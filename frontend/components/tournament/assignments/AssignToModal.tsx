"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Dropdown } from "@/components/ui/Dropdown";
import { Modal } from "@/components/ui/Modal";
import type { TournamentEvent, TournamentTrack } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";

/** Picks the track, then the event on it, that a board selection goes onto. */
export function AssignToModal({
  count,
  tracks,
  initialTrackId,
  events,
  onAssign,
  onClose,
}: {
  count: number;
  tracks: TournamentTrack[];
  /** The track picked on open — the tab showing, when it is one. */
  initialTrackId: number | null;
  /** Every event, not just the tab's: the picked track may be one it hides. */
  events: TournamentEvent[];
  onAssign: (eventId: number, trackId: number) => void;
  onClose: () => void;
}) {
  const [trackId, setTrackId] = useState<number | null>(initialTrackId ?? tracks[0]?.id ?? null);
  const [text, setText] = useState("");
  const [event, setEvent] = useState<TournamentEvent | null>(null);
  const onTrack = events.filter((e) => e.tracks.some((t) => t.id === trackId));

  return (
    <Modal
      title={`Assign ${count} ${count === 1 ? "member" : "members"}`}
      onClose={onClose}
      width={420}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!event || trackId === null}
            onClick={() => {
              if (!event || trackId === null) return;
              onAssign(event.id, trackId);
              onClose();
            }}
          >
            Assign
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <Dropdown
          label="Track"
          value={trackId === null ? "" : String(trackId)}
          onChange={(value) => {
            setTrackId(Number(value));
            setText("");
            setEvent(null);
          }}
          options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
          placeholder="Pick a track"
          fullWidth
        />
        <Combobox
          // Remounted per track, so the event list it opens on is that track's.
          key={trackId ?? "none"}
          label="Event"
          options={onTrack}
          getId={(e) => e.id}
          getLabel={eventNameWithDivision}
          value={text}
          onChange={(next, matched) => {
            setText(next);
            setEvent(matched);
          }}
          allowFreeText={false}
          placeholder="Type an event"
          emptyMessage="No events on this track"
          font="sans"
          locked={trackId === null}
        />
      </div>
    </Modal>
  );
}
