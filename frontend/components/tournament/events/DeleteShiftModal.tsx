"use client";

import { useEffect, useState } from "react";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { Spinner } from "@/components/ui/Spinner";
import {
  ApiError,
  type ShiftDeleteImpact,
  type TournamentShift,
  tournamentShiftsApi,
} from "@/lib/api";

interface DeleteShiftModalProps {
  tournamentId: number;
  /** One from a row or the panel, several from the selection toolbar. */
  shifts: TournamentShift[];
  onClose: () => void;
  /** The ids that actually went — on a partial failure the modal stays open. */
  onDeleted: (ids: number[]) => void;
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function DeleteShiftModal({
  tournamentId,
  shifts,
  onClose,
  onDeleted,
}: DeleteShiftModalProps) {
  const [impact, setImpact] = useState<ShiftDeleteImpact[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const shiftIds = shifts.map((s) => s.id).join(",");

  useEffect(() => {
    const ids = shiftIds.split(",").map(Number);
    tournamentShiftsApi
      .deleteImpact(tournamentId, ids)
      .then(setImpact)
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.message : "Couldn't check what uses it.");
        setImpact([]);
      });
  }, [tournamentId, shiftIds]);

  const single = shifts.length === 1 ? shifts[0] : null;
  const it = single ? "it" : "them";
  const total = (key: keyof Omit<ShiftDeleteImpact, "shift_id">) =>
    (impact ?? []).reduce((sum, i) => sum + i[key], 0);
  const events = shifts.reduce((sum, s) => sum + s.event_count, 0);
  const availability = total("availability_count");
  const options = total("option_count");
  const assignments = total("assignment_count");

  const effects = [
    events > 0 && `Removes ${it} from ${count(events, "event")}.`,
    availability > 0 &&
      `Removes ${it} from ${count(availability, "member")}${availability === 1 ? "'s" : "'"} availability.`,
    options > 0 &&
      `Removes ${it} from ${count(options, "availability option")} on your forms. An option left with no shifts becomes a "can't make it" choice that clears a member's shifts on that day.`,
    assignments > 0 &&
      `Unpins ${count(assignments, "staffing assignment")} from ${it}. Those people stay on their events with no shift.`,
  ].filter((effect): effect is string => Boolean(effect));

  return (
    <BulkDeleteModal
      items={shifts}
      noun="shift"
      notReady={impact === null}
      onDelete={(s) => tournamentShiftsApi.delete(tournamentId, s.id)}
      onClose={onClose}
      onDeleted={onDeleted}
      description={
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <span>
            Delete <strong>{single ? single.label : `${shifts.length} shifts`}</strong>?
          </span>
          {impact === null ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
              <Spinner />
            </div>
          ) : loadError ? (
            <span style={{ color: "var(--color-danger)" }}>
              {loadError} Deleting also removes {it} from any availability and forms that list {it}.
            </span>
          ) : effects.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "18px" }}>
              {effects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          ) : (
            <span>Nothing else uses {it}.</span>
          )}
        </div>
      }
    />
  );
}
