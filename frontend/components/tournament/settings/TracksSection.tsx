"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError, TournamentTrack, TournamentTrackDeleteResult, University,
  tournamentTracksApi, universitiesApi,
} from "@/lib/api";
import { formatTrackDates, placeOf } from "@/lib/tournamentDisplay";
import {
  EMPTY_TRACK_DRAFT, TrackDraft, trackDraftPayload, trackToDraft, validateTrackDraft,
} from "@/lib/trackDraft";
import { TrackFields } from "@/components/tournament/TrackFields";
import { SettingsSection } from "@/components/settings/SettingsRow";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  IconCalendar, IconChevronDown, IconChevronRight, IconLocation, IconPlus, IconRestore, IconTrash,
} from "@/components/ui/Icons";

// A row the TD added but hasn't saved. Keyed by a negative id so it shares
// one keyspace with real track ids in `drafts`/`errors` without colliding.
interface NewTrackRow { key: number }

export interface TrackEditor {
  tracks:       TournamentTrack[] | null;
  newRows:      NewTrackRow[];
  universities: University[];
  loadError:    string | undefined;
  drafts:       Record<number, TrackDraft>;
  errors:       Record<number, Record<string, string>>;
  isDirty:      boolean;
  setDraft:     (key: number, updates: Partial<TrackDraft>) => void;
  /** Appends an empty row and returns its key, so the caller can expand it. */
  addRow:       () => number;
  discardRow:   (key: number) => void;
  reset:        () => void;
  /** Creates and updates every pending row. Returns an error, or null. */
  save:         () => Promise<string | null>;
  onReplaced:   (track: TournamentTrack) => void;
  onDeleted:    (trackId: number, result: TournamentTrackDeleteResult) => void;
}

/**
 * Track edits live here rather than inside the section so the settings page
 * can put them behind the same FloatingSaveBar as its own fields — one set
 * of unsaved changes, one save, one navigation guard. Adding a track is an
 * unsaved row rather than an immediate POST for the same reason.
 *
 * Deleting stays immediate: it is its own action, with its own confirmation
 * and a two-outcome result the TD has to read.
 */
export function useTrackEditor(tournamentId: number, onChanged: () => void): TrackEditor {
  const [tracks, setTracks] = useState<TournamentTrack[] | null>(null);
  const [newRows, setNewRows] = useState<NewTrackRow[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Record<number, TrackDraft>>({});
  const [errors, setErrors] = useState<Record<number, Record<string, string>>>({});

  useEffect(() => {
    // The staff listing — the only place pending-delete tracks appear, which
    // is what makes restoring one possible at all.
    tournamentTracksApi.list(tournamentId)
      .then((loaded) => {
        setTracks(loaded);
        setDrafts(Object.fromEntries(loaded.map((track) => [track.id, trackToDraft(track)])));
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load tracks.");
        setTracks([]);
      });
  }, [tournamentId]);

  useEffect(() => { universitiesApi.list().then(setUniversities).catch(() => {}); }, []);

  const isDirty = useMemo(
    () => newRows.length > 0
      || (tracks ?? []).some((track) => JSON.stringify(drafts[track.id]) !== JSON.stringify(trackToDraft(track))),
    [tracks, newRows, drafts],
  );

  const setDraft = useCallback((key: number, updates: Partial<TrackDraft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...updates } }));
  }, []);

  const addRow = useCallback(() => {
    // Negative and decreasing — never collides with a real track id.
    const key = -Date.now();
    setNewRows((current) => [...current, { key }]);
    setDrafts((current) => ({ ...current, [key]: EMPTY_TRACK_DRAFT }));
    return key;
  }, []);

  const discardRow = useCallback((key: number) => {
    setNewRows((current) => current.filter((row) => row.key !== key));
    setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }, []);

  const reset = useCallback(() => {
    setNewRows([]);
    setDrafts(Object.fromEntries((tracks ?? []).map((track) => [track.id, trackToDraft(track)])));
    setErrors({});
  }, [tracks]);

  const save = useCallback(async (): Promise<string | null> => {
    const live = tracks ?? [];
    const edited = live.filter((track) => JSON.stringify(drafts[track.id]) !== JSON.stringify(trackToDraft(track)));
    if (edited.length === 0 && newRows.length === 0) return null;

    // Names are checked against the other *drafts*, not the saved rows: two
    // new rows both called "Day 1" have to collide here, since neither
    // exists server-side yet for the other to conflict with.
    const allKeys = [...live.map((t) => t.id), ...newRows.map((r) => r.key)];
    const fieldErrors: Record<number, Record<string, string>> = {};
    for (const key of [...edited.map((t) => t.id), ...newRows.map((r) => r.key)]) {
      const found = validateTrackDraft(drafts[key], allKeys.filter((k) => k !== key).map((k) => drafts[k]?.name ?? ""));
      if (Object.keys(found).length > 0) fieldErrors[key] = found;
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return "Some tracks need fixing before this can be saved.";
    }
    setErrors({});

    try {
      // Sequential, not Promise.all: each write re-runs the "at least one
      // live primary track" guard against the rows already committed, and
      // firing them together makes which one sees which state a race.
      const saved = new Map<number, TournamentTrack>();
      for (const track of edited) {
        saved.set(track.id, await tournamentTracksApi.update(tournamentId, track.id, trackDraftPayload(drafts[track.id])));
      }
      const created: TournamentTrack[] = [];
      for (const row of newRows) {
        created.push(await tournamentTracksApi.create(tournamentId, trackDraftPayload(drafts[row.key])));
      }

      setTracks((current) => [...(current ?? []).map((track) => saved.get(track.id) ?? track), ...created]);
      setDrafts((current) => {
        const next = { ...current };
        for (const row of newRows) delete next[row.key];
        for (const track of [...saved.values(), ...created]) next[track.id] = trackToDraft(track);
        return next;
      });
      setNewRows([]);
      onChanged();
      return null;
    } catch (err: unknown) {
      return err instanceof ApiError ? err.message : "Failed to save tracks.";
    }
  }, [tournamentId, tracks, newRows, drafts, onChanged]);

  const onReplaced = useCallback((track: TournamentTrack) => {
    setTracks((current) => current?.map((t) => (t.id === track.id ? track : t)) ?? current);
    setDrafts((current) => ({ ...current, [track.id]: trackToDraft(track) }));
    onChanged();
  }, [onChanged]);

  const onDeleted = useCallback((trackId: number, result: TournamentTrackDeleteResult) => {
    setTracks((current) => {
      if (!current) return current;
      // purged: gone. Otherwise it is pending delete and stays listed here —
      // this is the only surface it appears on, and where it gets restored.
      return result.purged
        ? current.filter((track) => track.id !== trackId)
        : current.map((track) => (track.id === trackId ? { ...track, is_archived: true } : track));
    });
    onChanged();
  }, [onChanged]);

  return {
    tracks, newRows, universities, loadError, drafts, errors, isDirty,
    setDraft, addRow, discardRow, reset, save, onReplaced, onDeleted,
  };
}

export function TracksSection({ editor, locked }: { editor: TrackEditor; locked: boolean }) {
  const { tracks, newRows, universities, loadError, drafts, errors } = editor;
  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TournamentTrack | null>(null);

  // The row a click on "Add track" just created — it scrolls itself into
  // view once rendered, since a new row lands below the fold on a
  // tournament with a few tracks and the save bar covers the bottom of it.
  const [scrollToKey, setScrollToKey] = useState<number | null>(null);

  function handleAdd() {
    const key = editor.addRow();
    setExpandedKey(key);
    setScrollToKey(key);
  }

  const livePrimaryCount = (tracks ?? []).filter((t) => t.is_primary && !t.is_archived).length;
  // Saved and unsaved rows in one list — they render identically apart from
  // the badge and what their trash button does.
  const rows: { key: number; track: TournamentTrack | null }[] = [
    ...(tracks ?? []).map((track) => ({ key: track.id, track })),
    ...newRows.map((row) => ({ key: row.key, track: null })),
  ];

  return (
    <SettingsSection title="Tracks">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px", padding: "16px 0 20px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0, maxWidth: "62ch", lineHeight: 1.55 }}>
          A track is a part of the tournament members sign up for separately. A competition day carries
          its own dates, venue and divisions, and the tournament&rsquo;s are the union of them. Anything
          else — test writing, review — is a track with none of those, and no shifts.
        </p>
        <Button
          type="button" variant="primary" size="md" disabled={locked}
          onClick={handleAdd}
          style={{ flexShrink: 0 }}
        >
          <IconPlus size={14} /> Add track
        </Button>
      </div>

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", margin: "0 0 12px" }}>
          {loadError}
        </p>
      )}

      {tracks === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}><Spinner size="sm" /></div>
      ) : rows.length > 0 && (
        <div style={{ margin: "0 0 20px", border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
          {rows.map((row, i) => (
            <TrackRow
              key={row.key}
              track={row.track}
              draft={drafts[row.key] ?? EMPTY_TRACK_DRAFT}
              errors={errors[row.key] ?? {}}
              universities={universities}
              locked={locked}
              // The backend refuses to leave a tournament with no live
              // primary track; greying the control says so before the 409.
              isOnlyPrimary={!!row.track?.is_primary && !row.track.is_archived && livePrimaryCount === 1}
              isLast={i === rows.length - 1}
              expanded={expandedKey === row.key}
              scrollIntoView={scrollToKey === row.key}
              onToggleExpanded={() => setExpandedKey((cur) => (cur === row.key ? null : row.key))}
              onDraftChange={(updates) => editor.setDraft(row.key, updates)}
              onRestored={editor.onReplaced}
              onDelete={() => (row.track ? setDeleteTarget(row.track) : editor.discardRow(row.key))}
            />
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteTrackModal
          track={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={(result) => editor.onDeleted(deleteTarget.id, result)}
        />
      )}
    </SettingsSection>
  );
}


/**
 * One row, saved or not. `track` is null for a row the TD just added: it has
 * no id and no badges, and its trash button discards the draft rather than
 * opening the delete modal.
 */
function TrackRow({
  track, draft, errors, universities, locked, isOnlyPrimary, isLast,
  expanded, scrollIntoView, onToggleExpanded, onDraftChange, onRestored, onDelete,
}: {
  track: TournamentTrack | null;
  draft: TrackDraft;
  errors: Record<string, string>;
  universities: University[];
  locked: boolean;
  isOnlyPrimary: boolean;
  isLast: boolean;
  expanded: boolean;
  scrollIntoView?: boolean;
  onToggleExpanded: () => void;
  onDraftChange: (updates: Partial<TrackDraft>) => void;
  onRestored: (track: TournamentTrack) => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const rowRef = useRef<HTMLDivElement>(null);

  // Scrolling the DOM is exactly what an effect is for — the row has to
  // exist before it can be brought into view.
  useEffect(() => {
    if (scrollIntoView) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollIntoView]);

  const isNew = track === null;
  const name = isNew ? (draft.name.trim() || "Untitled track") : track.name;
  const place = track && placeOf(track);
  const dates = track && formatTrackDates(track);
  const readOnly = locked || !!track?.is_archived;

  async function restore() {
    if (!track) return;
    setBusy(true);
    setError(undefined);
    try {
      onRestored(await tournamentTracksApi.restore(track.tournament_id, track.id));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to restore track.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rowRef} style={{ borderBottom: isLast ? "none" : "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px" }}>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? `Collapse ${name}` : `Edit ${name}`}
          style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
        >
          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
            color: isNew || track?.is_archived ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
          }}>
            {name}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {place && (
              <span style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <IconLocation />{place}
              </span>
            )}
            {dates && (
              <span style={{ display: "flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
                <IconCalendar />{dates}
              </span>
            )}
            {track?.division?.map((d) => <Badge key={d}>{d}</Badge>)}
          </span>
        </button>

        {isNew && <Badge>Unsaved</Badge>}
        {track?.is_primary && <Badge>Competition day</Badge>}
        {track?.is_archived && <Badge variant="removed">Pending delete</Badge>}

        <div style={{ display: "flex", gap: "6px" }}>
          {track?.is_archived ? (
            <Button
              type="button" variant="secondary" size="sm" iconOnly title="Restore"
              loading={busy} disabled={locked} onClick={restore}
              aria-label={`Restore ${name}`}
              style={{ width: "28px", height: "28px", padding: 0 }}
            >
              <IconRestore size={14} />
            </Button>
          ) : (
            <Button
              type="button" variant="secondary" size="sm" iconOnly
              title={isNew ? "Discard" : isOnlyPrimary ? "A tournament needs at least one competition day" : "Delete"}
              onClick={onDelete}
              disabled={busy || locked || isOnlyPrimary}
              aria-label={`${isNew ? "Discard" : "Delete"} ${name}`}
              style={{ width: "28px", height: "28px", padding: 0, color: "var(--color-danger)" }}
            >
              <IconTrash size={14} />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "4px 12px 16px 34px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <Input
            label="Name" font="sans" fullWidth locked={readOnly}
            placeholder="e.g. Day 1 or Test Writing"
            value={draft.name}
            onChange={(e) => onDraftChange({ name: e.target.value })}
            error={errors.name}
            autoFocus={isNew}
          />
          <TrackFields
            draft={draft}
            errors={errors}
            universities={universities}
            locked={readOnly}
            onChange={onDraftChange}
          />
          {error && <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", margin: 0 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Deleting a track has two outcomes and the TD's next move differs, so the
 * modal has two phases: confirm, then the result.
 *
 * The blocking references are only known once the delete has run — there is
 * no preflight route, and a track with nothing pointing at it is gone in the
 * same call. So the warning before is about the member data, and the report
 * after names what is still holding the track in pending-delete.
 */
function DeleteTrackModal({ track, onClose, onDone }: {
  track: TournamentTrack;
  onClose: () => void;
  onDone: (result: TournamentTrackDeleteResult) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<TournamentTrackDeleteResult | null>(null);

  async function deleteTrack() {
    setDeleting(true);
    setError(undefined);
    try {
      const outcome = await tournamentTracksApi.delete(track.tournament_id, track.id);
      setResult(outcome);
      onDone(outcome);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to delete track.");
    } finally {
      setDeleting(false);
    }
  }

  if (result) {
    return (
      <Modal title={result.purged ? "Track deleted" : "Track pending deletion"} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
            {result.purged ? (
              <><strong>{track.name}</strong> is gone, along with {result.member_rows_deleted} member response(s) for it.</>
            ) : (
              <>
                <strong>{track.name}</strong> is still referenced by {result.blocked_by.join(" and ")}, so it is
                hidden everywhere but here rather than deleted. Repoint those to another track and it deletes
                itself — taking {result.member_rows_deleted} member response(s) with it. Restore it any time until then.
              </>
            )}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="button" variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Delete track" onClose={onClose} variant="danger">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
          Delete <strong>{track.name}</strong>? Every member&rsquo;s status, availability, lunch and event
          preferences for this track go with it. If shifts, events or a form field still point here, the
          track is held as pending deletion instead until you repoint them.
        </p>
        {error && <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button type="button" variant="danger" onClick={deleteTrack} loading={deleting}>Delete track</Button>
        </div>
      </div>
    </Modal>
  );
}
