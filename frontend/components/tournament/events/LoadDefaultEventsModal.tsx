"use client";

import { useEffect, useMemo, useState } from "react";
import {
  seasonEventsApi, tournamentEventsApi, ApiError,
  SeasonEvent, TournamentEvent, TournamentDivision,
} from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

const PREVIEW_ROW_COLUMNS = "1fr 90px 1fr";

interface LoadDefaultEventsModalProps {
  tournamentId: number;
  divisions: TournamentDivision[];
  existingEvents: TournamentEvent[];
  onClose: () => void;
  onLoaded: (created: TournamentEvent[]) => void;
}

export function LoadDefaultEventsModal({ tournamentId, divisions, existingEvents, onClose, onLoaded }: LoadDefaultEventsModalProps) {
  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // No year param — matches the backend's own load-defaults query, which
    // pulls every active SeasonEvent for the tournament's divisions regardless
    // of year. Filtered client-side below so the preview is exactly what the
    // backend will create.
    seasonEventsApi.list()
      .then(setSeasonEvents)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Failed to load season events."));
  }, []);

  const existingPairs = useMemo(
    () => new Set(existingEvents.filter((e) => e.event_id !== null).map((e) => `${e.event_id}:${e.division}`)),
    [existingEvents]
  );

  const previewRows = useMemo(() => {
    if (!seasonEvents) return [];
    return seasonEvents
      .filter((se) => se.is_active && divisions.includes(se.division) && !existingPairs.has(`${se.event_id}:${se.division}`))
      .sort((a, b) => a.division.localeCompare(b.division) || a.event.name.localeCompare(b.event.name));
  }, [seasonEvents, divisions, existingPairs]);

  async function handleConfirm() {
    setConfirming(true);
    setLoadError(undefined);
    try {
      const result = await tournamentEventsApi.loadDefaults(tournamentId);
      onLoaded(result.created);
      onClose();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load default events.");
      setConfirming(false);
    }
  }

  return (
    <Modal title="Load default events" onClose={onClose} width={650}>
      {seasonEvents === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "16px" }}>
            {previewRows.length === 0
              ? "There are no new default events to add for this tournament's divisions."
              : `This will add ${previewRows.length} event${previewRows.length === 1 ? "" : "s"} to this tournament:`}
          </p>

          {previewRows.length > 0 && (
            <div style={{ maxHeight: "360px", overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", marginBottom: "16px" }}>
              <div style={{
                display: "grid", gridTemplateColumns: PREVIEW_ROW_COLUMNS, gap: "10px",
                padding: "10px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
                fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border)",
                position: "sticky", top: 0, background: "var(--color-surface)",
              }}>
                <span>Event</span>
                <span style={{ textAlign: "center" }}>Division</span>
                <span>Category</span>
              </div>
              {previewRows.map((se, i) => (
                <PreviewRow key={se.id} seasonEvent={se} isLast={i === previewRows.length - 1} />
              ))}
            </div>
          )}

          {loadError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "12px" }}>
              {loadError}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            {previewRows.length > 0 && (
              <Button type="button" variant="primary" loading={confirming} onClick={handleConfirm}>
                Add {previewRows.length} event{previewRows.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function PreviewRow({ seasonEvent, isLast }: { seasonEvent: SeasonEvent; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: PREVIEW_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: "8px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{seasonEvent.event.name}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {seasonEvent.division}
      </span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
        {seasonEvent.event.category.name}
      </span>
    </div>
  );
}
