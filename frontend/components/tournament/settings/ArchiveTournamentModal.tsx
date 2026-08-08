"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { tournamentsApi, Tournament, ApiError } from "@/lib/api";

interface ArchiveTournamentModalProps {
  tournamentId: number;
  tournamentName: string;
  mode: "archive" | "unarchive";
  onClose: () => void;
  onDone: (updated: Tournament) => void;
}

export function ArchiveTournamentModal({ tournamentId, tournamentName, mode, onClose, onDone }: ArchiveTournamentModalProps) {
  const confirmPhrase = mode === "archive" ? "ARCHIVE" : "UNARCHIVE";
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const canSubmit = confirmText === confirmPhrase;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(undefined);
    setLoading(true);
    try {
      const updated = mode === "archive"
        ? await tournamentsApi.archive(tournamentId)
        : await tournamentsApi.unarchive(tournamentId);
      onDone(updated);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <Modal title={mode === "archive" ? "Archive tournament" : "Unarchive tournament"} onClose={onClose} type="danger">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {mode === "archive" ? (
            <>
              This locks <strong>{tournamentName}</strong> as read-only — roles, members, events, and
              settings can&rsquo;t be changed until it&rsquo;s unarchived. It also drops off the public
              directory.
            </>
          ) : (
            <>This restores full editing access to <strong>{tournamentName}</strong>.</>
          )}
        </p>

        <Input
          label={`Type ${confirmPhrase} to confirm`}
          type="text"
          font="sans"
          fullWidth
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!canSubmit}>
            {mode === "archive" ? "Archive tournament" : "Unarchive tournament"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
