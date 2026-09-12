"use client";

import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { tournamentShiftsApi, TournamentShift } from "@/lib/api";

interface DeleteShiftModalProps {
  tournamentId: number;
  /** One from a row or the panel, several from the selection toolbar. */
  shifts: TournamentShift[];
  onClose: () => void;
  /** The ids that actually went — on a partial failure the modal stays open. */
  onDeleted: (ids: number[]) => void;
}

export function DeleteShiftModal({ tournamentId, shifts, onClose, onDeleted }: DeleteShiftModalProps) {
  const single = shifts.length === 1 ? shifts[0] : null;
  const attachedCount = shifts.filter((s) => s.event_count > 0).length;

  return (
    <BulkDeleteModal
      items={shifts}
      noun="shift"
      onDelete={(s) => tournamentShiftsApi.delete(tournamentId, s.id)}
      onClose={onClose}
      onDeleted={onDeleted}
      description={single ? (
        <>
          Delete <strong>{single.label}</strong>?
          {single.event_count > 0
            ? ` This shift is attached to ${single.event_count} event${single.event_count === 1 ? "" : "s"} — deleting will remove it from all of them.`
            : " It isn't attached to any events."}
        </>
      ) : (
        <>
          Delete <strong>{shifts.length} shifts</strong>?
          {attachedCount > 0
            ? ` ${attachedCount} of them are attached to events — deleting removes them from those events.`
            : " None of them are attached to any events."}
        </>
      )}
    />
  );
}
