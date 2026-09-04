"use client";

import { useEffect, useMemo, useState } from "react";
import {
  tournamentShiftsApi, tournamentEventsApi, ApiError,
  TournamentEvent, TournamentShift, TournamentTrack,
} from "@/lib/api";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { enumerateDays } from "@/lib/date";
import { toDateInput, toTimeInput, fromDayAndTime } from "@/lib/timeFormat";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { TournamentDayPicker } from "@/components/tournament/TournamentDayPicker";
import { DeleteShiftModal } from "@/components/tournament/events/DeleteShiftModal";
import { IconPlus, IconTrash, IconEvents, IconSearch, IconX } from "@/components/ui/Icons";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const SHIFT_PANEL_WIDTH = 600;

interface ShiftDraft {
  label: string;
  trackId: number | null;
  // Split day + time-of-day: a shift doesn't cross midnight, so there is
  // exactly one day to pick — and it has to be one of its *track's* days,
  // which is what the day picker is fed.
  day: string;
  startTime: string;
  endTime: string;
}

function draftFromShift(shift: TournamentShift | null, defaultTrackId: number | null): ShiftDraft {
  if (!shift) return { label: "", trackId: defaultTrackId, day: "", startTime: "", endTime: "" };
  return {
    label: shift.label,
    trackId: shift.track_id,
    day: toDateInput(shift.start),
    startTime: toTimeInput(shift.start),
    endTime: toTimeInput(shift.end),
  };
}

/**
 * A shift's day, defaulted when there's only one it could be. Applied
 * wherever the draft is (re)built so the dirty baseline agrees with the
 * initial state — otherwise a new shift would read as dirty on open.
 */
function draftWithDayDefault(
  shift: TournamentShift | null, defaultTrackId: number | null, tracks: TournamentTrack[],
): ShiftDraft {
  const draft = draftFromShift(shift, defaultTrackId);
  if (!draft.day && draft.trackId !== null) {
    const days = trackDays(tracks.find((t) => t.id === draft.trackId));
    // Only when there is nothing to choose — a multi-day track gets a
    // picker, and pre-filling it would be a guess at which day was meant.
    if (days.length === 1) draft.day = days[0];
  }
  return draft;
}

/** The days a shift on this track may fall on — its own range, not the tournament's. */
function trackDays(track: TournamentTrack | undefined): string[] {
  if (!track?.start_date || !track.end_date) return [];
  return enumerateDays(track.start_date, track.end_date);
}

interface ShiftPanelProps {
  tournamentId: number;
  /** null = creating a new shift. */
  shift: TournamentShift | null;
  /** Competition days only — a cosmetic track has no dates to validate against and can hold no shifts. */
  tracks: TournamentTrack[];
  /** The whole tournament's events, so the Events section can filter locally. */
  events: TournamentEvent[];
  /** Pre-selects the track for a new shift — the one the tab is filtered to. */
  defaultTrackId?: number | null;
  locked: boolean;
  onClose: () => void;
  onSaved: (shift: TournamentShift) => void;
  onDeleted: (id: number) => void;
  /** An event's shift set changed — the tab keeps its own copy of both lists. */
  onEventUpdated: (event: TournamentEvent) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function ShiftPanel({
  tournamentId, shift, tracks, events, defaultTrackId = null, locked,
  onClose, onSaved, onDeleted, onEventUpdated, onDirtyChange,
  onPrev, onNext, hasPrev, hasNext,
}: ShiftPanelProps) {
  const { guard } = useUnsavedChanges();

  // The shift this panel is editing. Starts as `shift` (null for "new") and
  // becomes the real row once a create lands, so the Events section can
  // appear without closing the panel.
  const [current, setCurrent] = useState<TournamentShift | null>(shift);
  const [draft, setDraft] = useState<ShiftDraft>(() => draftWithDayDefault(shift, defaultTrackId, tracks));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ShiftDraft, string>>>({});
  const [eventError, setEventError] = useState<string | undefined>(undefined);
  const [showDelete, setShowDelete] = useState(false);

  const isNew = current === null;
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftWithDayDefault(current, defaultTrackId, tracks)),
    [draft, current, defaultTrackId, tracks],
  );

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const days = trackDays(tracks.find((t) => t.id === draft.trackId));

  function patch(p: Partial<ShiftDraft>) {
    setDraft((d) => {
      const next = { ...d, ...p };
      // Moving a shift to another track is how a TD clears the reference
      // blocking that track's delete. The day has to follow: the old one
      // may not exist on the new track at all.
      if (p.trackId !== undefined && p.trackId !== d.trackId) {
        const nextDays = trackDays(tracks.find((t) => t.id === p.trackId));
        // A single-day track has no choice to offer, so the picker isn't
        // rendered at all and the day is filled in from here instead.
        next.day = nextDays.includes(d.day) ? d.day : (nextDays[0] ?? "");
      }
      return next;
    });
    setFieldErrors((cur) => {
      const next = { ...cur };
      for (const key of Object.keys(p) as (keyof ShiftDraft)[]) delete next[key];
      return next;
    });
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof ShiftDraft, string>> = {};
    if (!draft.label.trim()) errors.label = "Required";
    if (draft.trackId === null) errors.trackId = "Required";
    if (!draft.day) errors.day = "Required";
    if (!draft.startTime) errors.startTime = "Required";
    if (!draft.endTime) errors.endTime = "Required";
    else if (draft.startTime && draft.endTime <= draft.startTime) errors.endTime = "Must be after the start.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const payload = {
        track_id: draft.trackId!,
        label: draft.label.trim(),
        start: fromDayAndTime(draft.day, draft.startTime)!,
        end: fromDayAndTime(draft.day, draft.endTime)!,
      };
      const saved = isNew
        ? await tournamentShiftsApi.create(tournamentId, payload)
        : await tournamentShiftsApi.update(tournamentId, current!.id, payload);
      setCurrent(saved);
      setDraft(draftFromShift(saved, defaultTrackId));
      onSaved(saved);
    } catch (err) {
      // The range check comes back as a 409 naming which end it's about
      // ("Shift start falls before ..." / "Shift end falls after ...") —
      // route it to that Input rather than only the floating bar.
      if (err instanceof ApiError && err.status === 409 && err.message.includes("Shift start")) {
        setFieldErrors({ startTime: err.message });
      } else if (err instanceof ApiError && err.status === 409 && err.message.includes("Shift end")) {
        setFieldErrors({ endTime: err.message });
      } else {
        setSaveError(err instanceof ApiError ? err.message : "Failed to save shift.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Discards the draft only — the panel stays open, matching EventPanel.
  function handleCancel() {
    setDraft(draftWithDayDefault(current, defaultTrackId, tracks));
    setFieldErrors({});
    setSaveError(undefined);
  }

  // An event's shifts are a property of the event, set whole-set — there is
  // no attach/detach route to call, so both directions are one PATCH.
  async function setEventShifts(event: TournamentEvent, shiftIds: number[]) {
    setEventError(undefined);
    try {
      onEventUpdated(await tournamentEventsApi.update(tournamentId, event.id, { shift_ids: shiftIds }));
    } catch (err) {
      setEventError(err instanceof ApiError ? err.message : "Failed to update event.");
      throw err;
    }
  }

  return (
    <DockedPanel
      onClose={() => guard(onClose)}
      width={SHIFT_PANEL_WIDTH}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={!hasPrev}
      nextDisabled={!hasNext}
      footer={!locked && (
        <FloatingSaveBar
          visible={isDirty}
          saving={saving}
          error={saveError}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    >
      {/* Extra bottom padding only while the save bar is up — it floats over
          the last 80-ish px of this scroll area. */}
      <div style={{ padding: `20px 28px ${!locked && isDirty ? "100px" : "20px"}` }}>
        <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
            {draft.label || (isNew ? "New shift" : "Shift")}
          </h2>
        </Card>

        <SettingsSection title="Details">
          <SettingsRow label="Label">
            <Input
              fullWidth font="sans" locked={locked}
              value={draft.label}
              onChange={(e) => patch({ label: e.target.value })}
              error={fieldErrors.label}
              placeholder="e.g. Morning"
            />
          </SettingsRow>

          {/* Only competition days appear: a cosmetic track has no dates for
              a shift to sit inside, and the backend refuses one outright. */}
          <SettingsRow label="Track">
            <Dropdown
              fullWidth
              locked={locked}
              value={draft.trackId !== null ? String(draft.trackId) : ""}
              onChange={(v) => patch({ trackId: Number(v) })}
              options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
              placeholder={tracks.length === 0 ? "No competition days yet" : "Select a track"}
              error={fieldErrors.trackId}
            />
          </SettingsRow>

          {days.length > 1 && (
            <SettingsRow label="Day">
              <TournamentDayPicker
                value={draft.day}
                onChange={(v) => patch({ day: v })}
                days={days}
                placeholder="Select a day"
                locked={locked}
                fullWidth
                error={fieldErrors.day}
              />
            </SettingsRow>
          )}

          <SettingsRow label="Start">
            <Input
              type="time" fullWidth locked={locked} value={draft.startTime}
              onChange={(e) => patch({ startTime: e.target.value })}
              error={fieldErrors.startTime}
            />
          </SettingsRow>

          <SettingsRow label="End" last>
            <Input
              type="time" fullWidth locked={locked} value={draft.endTime}
              onChange={(e) => patch({ endTime: e.target.value })}
              error={fieldErrors.endTime}
            />
          </SettingsRow>
        </SettingsSection>

        {/* Needs a real shift id to attach to, so this only appears once the
            shift has been created — same rule EventPanel's Shifts section
            follows. Not a SettingsSection: attaching events is a working
            surface with its own search and filters, not a labelled field. */}
        {!isNew && current && (
          <ShiftEventsSection
            shiftId={current.id}
            trackId={current.track_id}
            events={events}
            locked={locked}
            error={eventError}
            onSetEventShifts={setEventShifts}
          />
        )}

        {!locked && !isNew && current && (
          <SettingsSection title="Danger Zone" variant="danger">
            <SettingsRow
              label="Delete shift"
              helper="This also removes it from any events, and drops every member's availability for it."
              last
              contentStyle={{ display: "flex", justifyContent: "flex-end" }}
            >
              <Button type="button" variant="secondary" onClick={() => setShowDelete(true)} style={{ color: "var(--color-danger)" }}>
                <IconTrash size={13} /> Delete
              </Button>
            </SettingsRow>
          </SettingsSection>
        )}
      </div>

      {showDelete && current && (
        <DeleteShiftModal
          tournamentId={tournamentId}
          shift={current}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { onDeleted(current.id); onClose(); }}
        />
      )}
    </DockedPanel>
  );
}

// Name + division — a custom event's name alone can collide across
// divisions, and a catalog-linked one reads better with its division here.
function eventNameWithDivision(e: TournamentEvent): string {
  const name = e.event?.name ?? e.name ?? "—";
  return e.division ? `${name} ${e.division}` : name;
}

const ALL = "all";

/**
 * The events this shift covers, and a picker for adding more.
 *
 * A popover was fine when a shift had a handful of candidates inside its own
 * time window. The window is gone — everything on the track is eligible — so
 * a regional's 40-odd events need searching and filtering, not scrolling.
 */
function ShiftEventsSection({ shiftId, trackId, events, locked, error, onSetEventShifts }: {
  shiftId: number;
  trackId: number;
  events: TournamentEvent[];
  locked: boolean;
  error?: string;
  onSetEventShifts: (event: TournamentEvent, shiftIds: number[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState<string>(ALL);
  const [busyId, setBusyId] = useState<number | null>(null);

  const attached = useMemo(
    () => events.filter((e) => e.shifts.some((s) => s.id === shiftId)),
    [events, shiftId],
  );

  // Everything on this shift's track that doesn't already hold it. The
  // track, not the clock, is the constraint now: an event's schedule *is*
  // its shifts, so there are no event bounds left to fit inside.
  const candidates = useMemo(() => {
    const attachedIds = new Set(attached.map((e) => e.id));
    return events.filter((e) => !attachedIds.has(e.id) && e.track_ids.includes(trackId));
  }, [events, attached, trackId]);

  const divisions = useMemo(
    () => [...new Set(candidates.map((e) => e.division).filter(Boolean))].sort() as string[],
    [candidates],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((e) => {
      if (division !== ALL && e.division !== division) return false;
      return !q || eventNameWithDivision(e).toLowerCase().includes(q);
    });
  }, [candidates, search, division]);

  async function toggle(event: TournamentEvent, attach: boolean) {
    setBusyId(event.id);
    const ids = event.shifts.map((s) => s.id);
    try {
      await onSetEventShifts(event, attach ? [...ids, shiftId] : ids.filter((id) => id !== shiftId));
    } catch {
      // Surfaced by the caller's own error state.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection title="Events">
      <div style={{ padding: "20px 0" }}>
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)",
          marginBottom: "10px",
        }}>
          {attached.length === 0
            ? "This shift covers no events yet."
            : `${attached.length} event${attached.length === 1 ? "" : "s"} on this shift.`}
        </div>

      {attached.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
          {attached.map((event) => (
            <div
              key={event.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                padding: "8px 10px", borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <IconEvents size={13} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                <span style={{
                  fontFamily: "var(--font-sans)", fontSize: "13px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {eventNameWithDivision(event)}
                </span>
              </div>
              {!locked && (
                <Button
                  type="button" variant="ghost" size="xs" iconOnly title="Remove"
                  loading={busyId === event.id}
                  onClick={() => toggle(event, false)}
                >
                  <IconX size={12} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!locked && (
        <div style={{
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
          padding: "10px", display: "flex", flexDirection: "column", gap: "10px",
        }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Input
              size="sm" font="sans" fullWidth
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events on this track"
              icon={<IconSearch size={13} />}
            />
            {divisions.length > 1 && (
              <ButtonGroup
                options={[{ value: ALL, label: "All" }, ...divisions.map((d) => ({ value: d, label: d }))]}
                value={division}
                onChange={setDivision}
                size="sm"
              />
            )}
          </div>

          {/* Capped and scrolled rather than growing the panel — a track can
              hold every event in the tournament. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "240px", overflowY: "auto" }}>
            {visible.length === 0 ? (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", margin: "4px 2px" }}>
                {candidates.length === 0
                  ? "Every event on this track is already covered by this shift."
                  : "No events match that search."}
              </p>
            ) : visible.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => toggle(event, true)}
                disabled={busyId === event.id}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "6px 8px", borderRadius: "var(--radius-sm)",
                  background: "none", border: "none", cursor: "pointer", textAlign: "left",
                  fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
                  opacity: busyId === event.id ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <IconPlus size={12} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {eventNameWithDivision(event)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginTop: "8px" }}>
          {error}
        </p>
      )}
      </div>
    </SettingsSection>
  );
}
