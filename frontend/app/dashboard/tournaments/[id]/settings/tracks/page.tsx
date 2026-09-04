"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
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
import { FormPopover } from "@/components/ui/FormPopover";
import { EditableText } from "@/components/ui/EditableText";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { IconArchive, IconLock, IconPlus, IconTrash, IconVolunteers } from "@/components/ui/Icons";

// Name / Status / Actions
const TRACK_ROW_COLUMNS = "1fr 100px 68px";

export default function TracksSettingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);
  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageTracks = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_tournament");
  const [tracks, setTracks] = useState<TournamentTrack[] | null>(null);
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

  function handleCreated(track: TournamentTrack) {
    setTracks((current) => [...(current ?? []), track]);
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
      <PageHeader heading="Tracks" subheading="Tournament Settings"
        action={
          <AddTrackPopover
            tournamentId={tournamentId}
            existingNames={tracks?.map((track) => track.name) ?? []}
            onCreated={handleCreated}
            trigger={
              <Button type="button" variant="primary">
                <IconPlus size={14} /> Add track
              </Button>
            }
          />
      }/>

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {error}
        </p>
      )}

      {tracks?.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconVolunteers size={28} />}
            title="No tracks yet"
            description="Add the participation tracks members can select on your forms."
            action={
              <AddTrackPopover
                tournamentId={tournamentId}
                existingNames={tracks?.map((track) => track.name) ?? []}
                onCreated={handleCreated}
                trigger={
                  <Button type="button" variant="primary" size="sm">
                    <IconPlus size={14} /> Add track
                  </Button>
                }
              />
            }
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <div style={{
            display: "grid", gridTemplateColumns: TRACK_ROW_COLUMNS, gap: "8px",
            padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
          }}>
            <span>Tracks — {tracks?.length}</span>
            <span style={{ textAlign: "center" }}>Status</span>
            <span />
          </div>

          {tracks?.map((track, i) => (
            <TrackRow
              key={track.id}
              tournamentId={tournamentId}
              track={track}
              isLast={i === (tracks?.length ?? 0) - 1}
              onChange={(next) => setTracks((current) => current?.map((item) => item.id === next.id ? next : item) ?? current)}
              onDelete={() => setDeleteTarget(track)}
            />
          ))}
        </Card>
      )}

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

function AddTrackPopover({ tournamentId, existingNames, onCreated, trigger }: {
  tournamentId: number;
  existingNames: string[];
  onCreated: (track: TournamentTrack) => void;
  trigger: ReactNode;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(close: () => void) {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const track = await tournamentTracksApi.create(tournamentId, trimmed);
      onCreated(track);
      setName("");
      close();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create track.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <FormPopover
      trigger={trigger}
      width={260}
      onOpenChange={(open) => {
        if (!open) { setName(""); setError(undefined); }
      }}
    >
      {(close) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Input
            label="Track name"
            placeholder="e.g. Debate"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(close); } }}
            error={error ?? (existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase()) ? "A track with this name already exists." : undefined)}
            size="sm"
            font="sans"
            fullWidth
            autoFocus
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="button" variant="primary" size="sm" loading={creating} disabled={!name.trim()} onClick={() => submit(close)}>
              Add track
            </Button>
          </div>
        </div>
      )}
    </FormPopover>
  );
}

function TrackRow({ tournamentId, track, isLast, onChange, onDelete }: { tournamentId: number; track: TournamentTrack; isLast: boolean; onChange: (track: TournamentTrack) => void; onDelete: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hovered, setHovered] = useState(false);

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
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: TRACK_ROW_COLUMNS, alignItems: "center",
        gap: "8px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      {track.is_archived ? (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-tertiary)" }}>
          {track.name}
        </span>
      ) : (
        <EditableText
          value={track.name}
          onSave={async (name) => onChange(await tournamentTracksApi.update(tournamentId, track.id, { name }))}
          title="Click to edit name"
        />
      )}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant={track.is_archived ? "removed" : "confirmed"}>
          {track.is_archived ? "Archived" : "Active"}
        </Badge>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: "6px" }}>
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title={track.is_archived ? "Restore" : "Archive"}
          loading={saving}
          onClick={() => setArchived(!track.is_archived)}
          style={{ width: "28px", height: "28px", padding: 0 }}
        >
          <IconArchive size={14} />
        </Button>
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Delete"
          onClick={onDelete}
          disabled={saving}
          aria-label={`Delete ${track.name}`}
          style={{ width: "28px", height: "28px", padding: 0, color: "var(--color-danger)" }}
        >
          <IconTrash size={14} />
        </Button>
      </div>
      {error && (
        <p style={{ gridColumn: "1 / -1", margin: "7px 0 0", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
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
