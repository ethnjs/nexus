"use client";

import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { tournamentEventsApi, TournamentEvent } from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";

interface DeleteEventModalProps {
  tournamentId: number;
  /** One from a row or the panel, several from the selection toolbar. */
  events: TournamentEvent[];
  onClose: () => void;
  /** The ids that actually went — on a partial failure the modal stays open. */
  onDeleted: (ids: number[]) => void;
}

export function DeleteEventModal({ tournamentId, events, onClose, onDeleted }: DeleteEventModalProps) {
  const single = events.length === 1 ? events[0] : null;

  return (
    <BulkDeleteModal
      items={events}
      noun="event"
      onDelete={(e) => tournamentEventsApi.delete(tournamentId, e.id)}
      onClose={onClose}
      onDeleted={onDeleted}
      description={single ? (
        <>Delete <strong>{eventNameWithDivision(single)}</strong>? This also detaches every shift from it. This can&rsquo;t be undone.</>
      ) : (
        <>Delete <strong>{events.length} events</strong>? This also detaches every shift from them. This can&rsquo;t be undone.</>
      )}
    />
  );
}
