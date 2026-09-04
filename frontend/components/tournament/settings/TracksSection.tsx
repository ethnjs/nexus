"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  ApiError, TournamentDivision, TournamentTrack, TournamentTrackCreate,
  TournamentTrackDeleteResult, University, tournamentTracksApi, universitiesApi,
  TOURNAMENT_DIVISIONS,
} from "@/lib/api";
import { formatTrackDates, placeOf } from "@/lib/tournamentDisplay";
import { SettingsSection } from "@/components/settings/SettingsRow";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Combobox } from "@/components/ui/Combobox";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Toggle } from "@/components/ui/Toggle";
import { IconChevronDown, IconChevronRight, IconPlus, IconRestore, IconTrash } from "@/components/ui/Icons";

// The editable shape of one track. `location` is display text — free-text or
// the matched university's name — and `university_id` is non-null only when
// it matched, exactly as the tournament's own location field works.
interface TrackDraft {
  name:          string;
  is_primary:    boolean;
  start_date:    string;
  end_date:      string;
  location:      string;
  university_id: number | null;
  division:      TournamentDivision[];
  allow_confirm: boolean;
}

function toDraft(track: TournamentTrack): TrackDraft {
  return {
    name:          track.name,
    is_primary:    track.is_primary,
    start_date:    track.start_date ?? "",
    end_date:      track.end_date ?? "",
    location:      track.location ?? track.university?.name ?? "",
    university_id: track.university?.id ?? null,
    division:      track.division ?? [],
    allow_confirm: track.allow_confirm,
  };
}

/**
 * The when/where/what a draft actually sends.
 *
 * A cosmetic track must carry *none* of the primary fields — the backend
 * rejects a partial combination outright — so switching a track to cosmetic
 * explicitly nulls them rather than leaving stale dates behind.
 */
function toPayload(draft: TrackDraft): TournamentTrackCreate {
  const base = {
    name:          draft.name.trim(),
    is_primary:    draft.is_primary,
    allow_confirm: draft.allow_confirm,
  };
  if (!draft.is_primary) {
    return { ...base, start_date: null, end_date: null, location: null, university_id: null, division: null };
  }
  return {
    ...base,
    start_date: draft.start_date,
    end_date:   draft.end_date,
    division:   draft.division,
    // Exactly one of the two, the other explicitly nulled — the same
    // atomic swap the tournament's own location field does.
    ...(draft.university_id
      ? { university_id: draft.university_id, location: null }
      : { location: draft.location.trim(), university_id: null }),
  };
}

/**
 * Mirrors require_primary_fields on the backend. Cosmetic tracks need no
 * checks here because the editor doesn't render those fields at all — the
 * payload nulls them, so the "only a primary track can have..." error is
 * unreachable from this UI.
 */
function validate(draft: TrackDraft, existingNames: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Cannot be empty.";
  else if (existingNames.some((other) => other.toLowerCase() === name.toLowerCase())) {
    errors.name = "A track with this name already exists.";
  }
  if (draft.is_primary) {
    if (!draft.start_date) errors.start_date = "Required on a primary track.";
    if (!draft.end_date) errors.end_date = "Required on a primary track.";
    else if (draft.start_date && draft.end_date < draft.start_date) errors.end_date = "Cannot be before start date.";
    if (!draft.university_id && !draft.location.trim()) errors.location = "Required on a primary track.";
    if (draft.division.length === 0) errors.division = "Select at least one division.";
  }
  return errors;
}

export function TracksSection({ tournamentId, locked, onChanged }: {
  tournamentId: number;
  locked: boolean;
  /** Fires whenever the set changes — the tournament's own dates/location/
   *  division are derived from these, so the page has to refetch it. */
  onChanged: () => void;
}) {
  const [tracks, setTracks] = useState<TournamentTrack[] | null>(null);
  const [universities, setUniversities] = useState<University[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TournamentTrack | null>(null);

  useEffect(() => {
    // The staff listing — the only place pending-delete tracks appear, which
    // is what makes restoring one possible at all.
    tournamentTracksApi.list(tournamentId)
      .then(setTracks)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Failed to load tracks.");
        setTracks([]);
      });
  }, [tournamentId]);
  useEffect(() => { universitiesApi.list().then(setUniversities).catch(() => {}); }, []);

  const livePrimaryCount = useMemo(
    () => (tracks ?? []).filter((t) => t.is_primary && !t.is_archived).length,
    [tracks],
  );

  function replace(next: TournamentTrack) {
    setTracks((current) => current?.map((t) => (t.id === next.id ? next : t)) ?? current);
    onChanged();
  }

  return (
    <SettingsSection title="Tracks">
      <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "24px" }}>
          <div style={{ maxWidth: "420px" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
              A primary track is a competition day and carries its own dates, venue and
              divisions — this tournament&rsquo;s are the union of them. A cosmetic track
              (e.g. Test Writing) has none of those, and no shifts.
            </div>
          </div>
          <AddTrackPopover
            tournamentId={tournamentId}
            existingNames={(tracks ?? []).map((t) => t.name)}
            universities={universities}
            onCreated={(track) => { setTracks((current) => [...(current ?? []), track]); onChanged(); }}
            trigger={
              <Button type="button" variant="secondary" size="md" disabled={locked}>
                <IconPlus size={14} /> Add track
              </Button>
            }
          />
        </div>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", margin: 0 }}>{error}</p>
        )}

        {tracks === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}><Spinner size="sm" /></div>
        ) : tracks.length === 0 ? (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", margin: 0 }}>
            No tracks yet.
          </p>
        ) : (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
            {tracks.map((track, i) => (
              <TrackEditorRow
                key={track.id}
                tournamentId={tournamentId}
                track={track}
                universities={universities}
                existingNames={tracks.filter((t) => t.id !== track.id).map((t) => t.name)}
                locked={locked}
                // The backend refuses to leave a tournament with no live
                // primary track; greying the control says so before the 409.
                isOnlyPrimary={track.is_primary && !track.is_archived && livePrimaryCount === 1}
                isLast={i === tracks.length - 1}
                expanded={expandedId === track.id}
                onToggleExpanded={() => setExpandedId((cur) => (cur === track.id ? null : track.id))}
                onChange={replace}
                onDelete={() => setDeleteTarget(track)}
              />
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteTrackModal
          tournamentId={tournamentId}
          track={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={(result) => {
            if (result.purged) {
              setTracks((current) => current?.filter((t) => t.id !== deleteTarget.id) ?? current);
            } else {
              setTracks((current) => current?.map((t) => (t.id === deleteTarget.id ? { ...t, is_archived: true } : t)) ?? current);
            }
            onChanged();
          }}
        />
      )}
    </SettingsSection>
  );
}

function AddTrackPopover({ tournamentId, existingNames, universities, onCreated, trigger }: {
  tournamentId: number;
  existingNames: string[];
  universities: University[];
  onCreated: (track: TournamentTrack) => void;
  trigger: ReactNode;
}) {
  const empty: TrackDraft = {
    name: "", is_primary: false, start_date: "", end_date: "",
    location: "", university_id: null, division: [], allow_confirm: false,
  };
  const [draft, setDraft] = useState<TrackDraft>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(close: () => void) {
    const fieldErrors = validate(draft, existingNames);
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    setCreating(true);
    setError(undefined);
    try {
      onCreated(await tournamentTracksApi.create(tournamentId, toPayload(draft)));
      setDraft(empty);
      setErrors({});
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
      width={340}
      onOpenChange={(open) => { if (!open) { setDraft(empty); setErrors({}); setError(undefined); } }}
    >
      {(close) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Input
            label="Track name"
            placeholder="e.g. Day 1 or Test Writing"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            error={errors.name}
            size="sm" font="sans" fullWidth autoFocus
          />
          <TrackFields
            draft={draft}
            errors={errors}
            universities={universities}
            locked={false}
            onChange={(updates) => setDraft((d) => ({ ...d, ...updates }))}
          />
          {error && <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="button" variant="primary" size="sm" loading={creating} disabled={!draft.name.trim()} onClick={() => submit(close)}>
              Add track
            </Button>
          </div>
        </div>
      )}
    </FormPopover>
  );
}

/**
 * The primary/cosmetic fields, shared by the add popover and the row editor.
 * The when/where/what only renders for a primary track — that is what keeps
 * the "only a primary track can have..." 422 unreachable.
 */
function TrackFields({ draft, errors, universities, locked, onChange }: {
  draft: TrackDraft;
  errors: Record<string, string>;
  universities: University[];
  locked: boolean;
  onChange: (updates: Partial<TrackDraft>) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <FieldRow label="Competition day" helper="Carries dates, a venue and divisions. Only these hold shifts.">
        <Toggle checked={draft.is_primary} onChange={(v) => onChange({ is_primary: v })} locked={locked} />
      </FieldRow>

      {draft.is_primary && (
        <>
          <div style={{ display: "flex", gap: "10px" }}>
            <Input
              label="Start" type="date" fullWidth size="sm" locked={locked}
              value={draft.start_date}
              onChange={(e) => onChange({ start_date: e.target.value })}
              error={errors.start_date}
            />
            <Input
              label="End" type="date" fullWidth size="sm" locked={locked}
              value={draft.end_date}
              onChange={(e) => onChange({ end_date: e.target.value })}
              error={errors.end_date}
            />
          </div>
          <Combobox
            label="Location"
            options={universities}
            getId={(u) => u.id}
            getLabel={(u) => u.name}
            getSearchText={(u) => `${u.name} ${u.abbreviation ?? ""}`}
            value={draft.location}
            onChange={(text, matched) => onChange({ location: text, university_id: matched?.id ?? null })}
            placeholder="e.g. UCI"
            locked={locked}
            error={errors.location}
          />
          <div>
            <ButtonGroup
              options={TOURNAMENT_DIVISIONS.map((d) => ({ value: d, label: d }))}
              value={draft.division}
              onChange={(v) => onChange({
                division: draft.division.includes(v as TournamentDivision)
                  ? draft.division.filter((x) => x !== v)
                  : [...draft.division, v as TournamentDivision],
              })}
              locked={locked}
            />
            {errors.division && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", margin: "6px 0 0" }}>
                {errors.division}
              </p>
            )}
          </div>
        </>
      )}

      <FieldRow label="Members may self-confirm" helper="Otherwise confirming is the TD's call and members can only opt out.">
        <Toggle checked={draft.allow_confirm} onChange={(v) => onChange({ allow_confirm: v })} locked={locked} />
      </FieldRow>
    </div>
  );
}

function FieldRow({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>{label}</div>
        {helper && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            {helper}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function TrackEditorRow({
  tournamentId, track, universities, existingNames, locked, isOnlyPrimary, isLast,
  expanded, onToggleExpanded, onChange, onDelete,
}: {
  tournamentId: number;
  track: TournamentTrack;
  universities: University[];
  existingNames: string[];
  locked: boolean;
  isOnlyPrimary: boolean;
  isLast: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (track: TournamentTrack) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<TrackDraft>(() => toDraft(track));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => { setDraft(toDraft(track)); setErrors({}); }, [track]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(toDraft(track));
  const dates = formatTrackDates(track);
  const place = placeOf(track);

  async function save() {
    const fieldErrors = validate(draft, existingNames);
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    setSaving(true);
    setError(undefined);
    try {
      onChange(await tournamentTracksApi.update(tournamentId, track.id, toPayload(draft)));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to save track.");
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    setSaving(true);
    setError(undefined);
    try {
      onChange(await tournamentTracksApi.restore(tournamentId, track.id));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to restore track.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px" }}>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? `Collapse ${track.name}` : `Edit ${track.name}`}
          style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
        >
          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
            color: track.is_archived ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
          }}>
            {track.name}
          </span>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[place, dates, track.division?.join(", ")].filter(Boolean).join(" · ")}
          </span>
        </button>

        {track.is_primary && <Badge>Competition day</Badge>}
        {track.is_archived && <Badge variant="removed">Pending delete</Badge>}

        <div style={{ display: "flex", gap: "6px" }}>
          {track.is_archived ? (
            <Button
              type="button" variant="secondary" size="sm" iconOnly title="Restore"
              loading={saving} disabled={locked} onClick={restore}
              aria-label={`Restore ${track.name}`}
              style={{ width: "28px", height: "28px", padding: 0 }}
            >
              <IconRestore size={14} />
            </Button>
          ) : (
            <Button
              type="button" variant="secondary" size="sm" iconOnly
              title={isOnlyPrimary ? "A tournament needs at least one competition day" : "Delete"}
              onClick={onDelete}
              disabled={saving || locked || isOnlyPrimary}
              aria-label={`Delete ${track.name}`}
              style={{ width: "28px", height: "28px", padding: 0, color: "var(--color-danger)" }}
            >
              <IconTrash size={14} />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "4px 12px 14px 34px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <Input
            label="Name" size="sm" font="sans" fullWidth locked={locked || track.is_archived}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            error={errors.name}
          />
          <TrackFields
            draft={draft}
            errors={errors}
            universities={universities}
            locked={locked || track.is_archived}
            onChange={(updates) => setDraft((d) => ({ ...d, ...updates }))}
          />
          {error && <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", margin: 0 }}>{error}</p>}
          {isDirty && !track.is_archived && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => { setDraft(toDraft(track)); setErrors({}); setError(undefined); }}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="sm" loading={saving} onClick={save}>
                Save track
              </Button>
            </div>
          )}
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
function DeleteTrackModal({ tournamentId, track, onClose, onDone }: {
  tournamentId: number;
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
      const outcome = await tournamentTracksApi.delete(tournamentId, track.id);
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
