"use client";

import { useState } from "react";
import { TracksSection, useTrackEditor } from "@/components/tournament/settings/TracksSection";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";

interface DefaultMove {
  trackId: number;
  trackName: string;
  from: string;
  to: string;
  count: number;
}

/**
 * The tournament's tracks, editable from the assignments board: the same
 * editor as Settings, plus the board's own question when a default role
 * changes — whether the people holding only the old default move with it.
 */
export function TrackSettingsModal({
  tournamentId,
  locked,
  soleDefaultHolders,
  onChanged,
  onClose,
}: {
  tournamentId: number;
  locked: boolean;
  /** How many bars on a track hold `roleId` as their only role. */
  soleDefaultHolders: (trackId: number, roleId: number) => number;
  /** A save, delete or restore went through. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const editor = useTrackEditor(tournamentId, onChanged);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<DefaultMove[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function roleLabel(roleId: number | null) {
    return editor.roles.find((role) => role.id === roleId)?.label ?? "No default role";
  }

  /** Tracks whose default role is changing away from one people still hold alone. */
  function pendingMoves(): DefaultMove[] {
    return (editor.tracks ?? []).flatMap((track) => {
      const next = editor.drafts[track.id]?.default_role_id ?? null;
      if (track.default_role_id === null || next === null || next === track.default_role_id) {
        return [];
      }
      const count = soleDefaultHolders(track.id, track.default_role_id);
      return count === 0
        ? []
        : [
            {
              trackId: track.id,
              trackName: track.name,
              from: roleLabel(track.default_role_id),
              to: roleLabel(next),
              count,
            },
          ];
    });
  }

  async function save(reassign: ReadonlySet<number>) {
    setSaving(true);
    const failed = await editor.save(reassign);
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  }

  function requestSave() {
    setError(null);
    const found = pendingMoves();
    if (found.length > 0) setMoves(found);
    else void save(new Set());
  }

  function requestClose() {
    if (editor.isDirty) setConfirmDiscard(true);
    else onClose();
  }

  return (
    <>
      <Modal
        title="Track settings"
        onClose={requestClose}
        width={720}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saving}
              disabled={locked || !editor.isDirty}
              onClick={requestSave}
            >
              Save
            </Button>
          </div>
        }
      >
        {error && <Banner variant="error" message={error} />}
        <TracksSection editor={editor} locked={locked} layout="tabs" />
      </Modal>
      {moves && (
        <ConfirmModal
          title="Change default roles"
          description={
            <>
              {moves.map((move) => (
                <p key={move.trackId} style={{ margin: "0 0 8px" }}>
                  {move.trackName}&rsquo;s default role is changing from{" "}
                  <strong>{move.from}</strong> to <strong>{move.to}</strong>. This will also change{" "}
                  {move.count} {move.count === 1 ? "assignment" : "assignments"} on this track whose
                  only role is {move.from} to {move.to}.
                </p>
              ))}
              Anyone who also holds another role on that event keeps their roles.
            </>
          }
          confirmLabel="Change roles"
          variant="primary"
          onConfirm={async () => {
            const ids = new Set(moves.map((move) => move.trackId));
            setMoves(null);
            await save(ids);
          }}
          onClose={() => setMoves(null)}
        />
      )}
      {confirmDiscard && (
        <ConfirmModal
          title="Discard changes"
          description="Discard your unsaved track changes?"
          confirmLabel="Discard"
          onConfirm={async () => onClose()}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}
