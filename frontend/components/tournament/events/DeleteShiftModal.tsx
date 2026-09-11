"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tournamentShiftsApi, ApiError, TournamentShift } from "@/lib/api";

interface DeleteShiftModalProps {
  tournamentId: number;
  /** One from a row or the panel, several from the selection toolbar. */
  shifts: TournamentShift[];
  onClose: () => void;
  /** The ids that actually went — on a partial failure the modal stays open. */
  onDeleted: (ids: number[]) => void;
}

export function DeleteShiftModal({ tournamentId, shifts, onClose, onDeleted }: DeleteShiftModalProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const single = shifts.length === 1 ? shifts[0] : null;
  const attachedCount = shifts.filter((s) => s.event_count > 0).length;
  const noun = single ? "shift" : `${shifts.length} shifts`;

  async function handleDelete() {
    setError(undefined);
    setLoading(true);
    const outcomes = await Promise.allSettled(
      shifts.map((s) => tournamentShiftsApi.delete(tournamentId, s.id)),
    );
    const deleted = shifts.filter((_, i) => outcomes[i].status === "fulfilled").map((s) => s.id);
    if (deleted.length > 0) onDeleted(deleted);

    const failure = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    if (!failure) { onClose(); return; }
    const reason = failure.reason instanceof ApiError ? failure.reason.message : "Something went wrong. Try again.";
    setError(single ? reason : `${outcomes.length - deleted.length} couldn't be deleted: ${reason}`);
    setLoading(false);
  }

  return (
    <Modal title={`Delete ${noun}`} onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {single ? (
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
        </p>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} onClick={handleDelete}>
            Delete {noun}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
