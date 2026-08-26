"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { ApiError, TournamentTrack, tournamentTracksApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { IconLock, IconPlus, IconTrash, IconVolunteers } from "@/components/ui/Icons";

export default function TracksSettingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);
  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageTracks = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_tournament");
  const [tracks, setTracks] = useState<TournamentTrack[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<TournamentTrack | null>(null);

  const loadTracks = useCallback(async () => {
    try {
      setTracks(await tournamentTracksApi.list(tournamentId));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load tracks.");
      setTracks([]);
    }
  }, [tournamentId]);

  useEffect(() => {
    if (canManageTracks) loadTracks();
  }, [canManageTracks, loadTracks]);

  async function createTrack() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const track = await tournamentTracksApi.create(tournamentId, name);
      setTracks((current) => [...(current ?? []), track]);
      setNewName("");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create track.");
    } finally {
      setCreating(false);
    }
  }

  if (membershipLoading || (canManageTracks && tracks === null)) {
    return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
  }

  if (!canManageTracks) {
    return (
      <div>
        <PageHeader heading="Tracks" subheading="Tournament Settings" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState icon={<IconLock size={28} />} title="No access" description="You need the manage tournament permission to view this page." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Tracks" subheading="Tournament Settings" />
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", margin: "-12px 0 20px" }}>
        Tracks describe the ways members can participate, such as test writing or day 1. Archive a track when it should no longer be offered; historical form fields remain intact.
      </p>

      <Card radius="lg" style={{ padding: "12px" }}>
        <div style={{ display: "flex", gap: "10px", margin: "4px 4px 12px" }}>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") createTrack(); }}
            placeholder="e.g. Test Writing"
            fullWidth
          />
          <Button type="button" variant="primary" onClick={createTrack} loading={creating} disabled={!newName.trim()}>
            <IconPlus size={14} /> Add track
          </Button>
        </div>

        {error && <p style={{ margin: "0 4px 12px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>}

        {tracks?.length === 0 ? (
          <EmptyState icon={<IconVolunteers size={28} />} title="No tracks yet" description="Add the participation tracks members can select on your forms." />
        ) : (
          <div style={{ borderTop: "1px solid var(--color-border)" }}>
            {tracks?.map((track) => (
              <TrackRow key={track.id} tournamentId={tournamentId} track={track} onChange={(next) => setTracks((current) => current?.map((item) => item.id === next.id ? next : item) ?? current)} onDelete={() => setDeleteTarget(track)} />
            ))}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <DeleteTrackModal
          tournamentId={tournamentId}
          track={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setTracks((current) => current?.filter((track) => track.id !== deleteTarget.id) ?? current);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function TrackRow({ tournamentId, track, onChange, onDelete }: { tournamentId: number; track: TournamentTrack; onChange: (track: TournamentTrack) => void; onDelete: () => void }) {
  const [name, setName] = useState(track.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const dirty = name.trim() !== track.name;

  useEffect(() => setName(track.name), [track.name]);

  async function saveName() {
    if (!dirty || !name.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      onChange(await tournamentTracksApi.update(tournamentId, track.id, { name: name.trim() }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to rename track.");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(is_archived: boolean) {
    setSaving(true);
    setError(undefined);
    try {
      onChange(await tournamentTracksApi.update(tournamentId, track.id, { is_archived }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to update track.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "12px 4px", borderBottom: "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ flex: 1 }}>
          <Input value={name} onChange={(event) => setName(event.target.value)} disabled={track.is_archived} fullWidth />
        </div>
        {track.is_archived && <Badge variant="default">Archived</Badge>}
        {dirty && <Button type="button" variant="secondary" size="sm" loading={saving} onClick={saveName} disabled={!name.trim()}>Save</Button>}
        <Button type="button" variant="secondary" size="sm" loading={saving} onClick={() => setArchived(!track.is_archived)}>
          {track.is_archived ? "Restore" : "Archive"}
        </Button>
        <Button type="button" variant="danger" size="sm" onClick={onDelete} disabled={saving} aria-label={`Delete ${track.name}`}>
          <IconTrash size={14} />
        </Button>
      </div>
      {error && <p style={{ margin: "7px 0 0", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}

function DeleteTrackModal({ tournamentId, track, onClose, onDeleted }: { tournamentId: number; track: TournamentTrack; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function deleteTrack() {
    setDeleting(true);
    setError(undefined);
    try {
      await tournamentTracksApi.delete(tournamentId, track.id);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to delete track.");
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete track" onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Delete <strong>{track.name}</strong>? This is only available while the track is not referenced by a form field.
        </p>
        {error && <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button type="button" variant="danger" onClick={deleteTrack} loading={deleting}>Delete track</Button>
        </div>
      </div>
    </Modal>
  );
}
