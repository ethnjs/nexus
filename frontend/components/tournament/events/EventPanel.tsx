"use client";

import { useEffect, useMemo, useState } from "react";
import {
  tournamentEventsApi, tournamentShiftsApi, tournamentTracksApi, canonicalEventsApi, ApiError,
  TournamentEvent, TournamentEventInput, TournamentShift, TournamentTrack, CanonicalEvent, TournamentDivision,
} from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { formatTime } from "@/lib/timeFormat";
import { formatDates } from "@/lib/tournamentDisplay";
import { enumerateDays } from "@/lib/date";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FormPopover } from "@/components/ui/FormPopover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { DeleteEventModal } from "@/components/tournament/events/DeleteEventModal";
import { CreateShiftForm } from "@/components/tournament/events/CreateShiftForm";
import { IconPlus, IconTrash, IconCalendar, IconX } from "@/components/ui/Icons";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const EVENT_PANEL_WIDTH = 600;

interface EventDraft {
  eventText: string;
  event_id: number | null;
  name: string | null;
  division: TournamentDivision | null;
  event_type: "standard" | "trial";
  building: string;
  room: string;
  floor: string;
  volunteers_needed: string;
  // The tracks this event runs on. Not derived from its shifts: a cosmetic
  // track (Test Writing) has none by construction, so an event that belongs
  // to one can only say so outright.
  trackIds: number[];
}

function draftFromEvent(event: TournamentEvent | null): EventDraft {
  return {
    eventText: event?.event?.name ?? event?.name ?? "",
    event_id: event?.event_id ?? null,
    name: event?.name ?? null,
    division: event?.division ?? null,
    event_type: event?.event_type ?? "standard",
    building: event?.building ?? "",
    room: event?.room ?? "",
    floor: event?.floor ?? "",
    volunteers_needed: event?.volunteers_needed != null ? String(event.volunteers_needed) : "",
    trackIds: event?.track_ids ?? [],
  };
}

interface EventPanelProps {
  tournamentId: number;
  /** null = creating a new event. */
  event: TournamentEvent | null;
  locked: boolean;
  onClose: () => void;
  onSaved: (event: TournamentEvent) => void;
  onDeleted: (id: number) => void;
  /** Lets the owning table block selection changes while this panel is dirty. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Prev/next through the table's current filtered/sorted order — omit both to hide the controls (e.g. while creating a new event, or editing several at once). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function EventPanel({
  tournamentId, event, locked, onClose, onSaved, onDeleted, onDirtyChange, onPrev, onNext, hasPrev, hasNext,
}: EventPanelProps) {
  const { selectedTournament } = useTournament();
  const divisions = selectedTournament?.division ?? [];
  const { guard } = useUnsavedChanges();

  // The event this panel is editing. Starts as `event` (null for "new"),
  // and becomes the real row once a create lands — so the Shifts section
  // can appear without closing the panel.
  const [current, setCurrent] = useState<TournamentEvent | null>(event);
  // A single-day tournament has only one valid day anyway — default to it
  // immediately instead of making every new event pick it.
  const [draft, setDraft] = useState<EventDraft>(() => draftFromEvent(event));
  const [canonicalEvents, setCanonicalEvents] = useState<CanonicalEvent[]>([]);
  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);
  // Every live track, competition day or not: an event can belong to an
  // undated one (Test Writing), which is the whole point of the bridge.
  const [tracks, setTracks] = useState<TournamentTrack[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [showDelete, setShowDelete] = useState(false);
  const [shiftError, setShiftError] = useState<string | undefined>(undefined);

  useEffect(() => {
    canonicalEventsApi.list().then(setCanonicalEvents).catch(() => {});
  }, []);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId).then(setAllShifts).catch(() => setAllShifts([]));
    tournamentTracksApi.list(tournamentId, { public: true }).then(setTracks).catch(() => setTracks([]));
  }, [tournamentId]);

  const isNew = current === null;
  // For a new event this compares against the blank default draft, so an
  // untouched "New event" panel reads as clean — closing it needs no
  // confirmation until the user actually types something.
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFromEvent(current)),
    [draft, current]
  );

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  function patch(p: Partial<EventDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function handleEventTextChange(text: string, matched: CanonicalEvent | null) {
    patch({ eventText: text, event_id: matched ? matched.id : null, name: matched ? null : text });
  }

  function buildPayload(): TournamentEventInput {
    return {
      name: draft.event_id ? null : (draft.name?.trim() || null),
      division: draft.division,
      event_type: draft.event_type,
      event_id: draft.event_id,
      building: draft.building.trim() || null,
      room: draft.room.trim() || null,
      floor: draft.floor.trim() || null,
      volunteers_needed: draft.volunteers_needed.trim() ? Number(draft.volunteers_needed) : null,
      track_ids: draft.trackIds,
    };
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);
    try {
      const payload = buildPayload();
      const saved = isNew
        ? await tournamentEventsApi.create(tournamentId, { ...payload, tournament_id: tournamentId })
        : await tournamentEventsApi.update(tournamentId, current!.id, payload);
      setCurrent(saved);
      setDraft(draftFromEvent(saved));
      onSaved(saved);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save event.");
    } finally {
      setSaving(false);
    }
  }

  // Discards the draft only — the panel stays open, matching the table's own
  // "Cancel" bar (ShiftsTab) rather than treating Cancel as a second Close.
  function handleCancel() {
    setDraft(draftFromEvent(current));
    setSaveError(undefined);
  }

  // Any shift the event doesn't already hold. There are no event bounds to
  // check against any more — the event's schedule *is* its shifts — so the
  // only rule left is the backend's: two shifts on one event can't overlap.
  const eligibleShifts = useMemo(() => {
    if (!allShifts || !current) return [];
    const attachedIds = new Set(current.shifts.map((s) => s.id));
    return allShifts.filter((s) => !attachedIds.has(s.id));
  }, [allShifts, current]);

  // An event's shifts are a property of the event, set whole-set — there is
  // no attach/detach route left to call, so both directions are one PATCH.
  // Adding also pulls in the shift's track server-side; removing never
  // takes a track away.
  async function setShiftIds(shiftIds: number[]) {
    if (!current) return;
    setShiftError(undefined);
    try {
      const updated = await tournamentEventsApi.update(tournamentId, current.id, { shift_ids: shiftIds });
      setCurrent(updated);
      setDraft(draftFromEvent(updated));
      onSaved(updated);
    } catch (err) {
      setShiftError(err instanceof ApiError ? err.message : "Failed to update shifts.");
      throw err;
    }
  }

  async function handleAttachShift(shift: TournamentShift) {
    if (!current) return;
    await setShiftIds([...current.shifts.map((s) => s.id), shift.id]);
  }

  // The shift already exists on the backend by the time this runs — the
  // PATCH failing would orphan a created-but-unattached shift, but it stays
  // visible on the Shifts tab and in the Add-shift list either way.
  async function handleCreateAndAttachShift(shift: TournamentShift) {
    setAllShifts((prev) => [...(prev ?? []), shift]);
    await handleAttachShift(shift);
  }

  async function handleDetachShift(shiftId: number) {
    if (!current) return;
    await setShiftIds(current.shifts.filter((s) => s.id !== shiftId).map((s) => s.id)).catch(() => {});
  }

  // Creating a shift from here needs one track and one of its days. With no
  // track or several there is no answer, so the control simply isn't offered.
  const newShiftTrack = useMemo(() => {
    if (draft.trackIds.length !== 1) return null;
    const track = tracks.find((t) => t.id === draft.trackIds[0]);
    return track?.is_primary ? track : null;
  }, [draft.trackIds, tracks]);
  const newShiftDays = newShiftTrack?.start_date && newShiftTrack.end_date
    ? enumerateDays(newShiftTrack.start_date, newShiftTrack.end_date)
    : [];

  const categoryName = draft.event_id
    ? (canonicalEvents.find((e) => e.id === draft.event_id)?.category.name ?? current?.event?.category.name)
    : undefined;

  return (
    <DockedPanel
      onClose={() => guard(onClose)}
      width={EVENT_PANEL_WIDTH}
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
      {/* Extra bottom padding only while the FloatingSaveBar is showing —
          it floats over the last 80-ish px of this scroll area, so without
          this the Danger Zone section would be unreachable while it's up. */}
      <div style={{ padding: `20px 28px ${!locked && isDirty ? "100px" : "20px"}` }}>
        <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
            {draft.eventText || (isNew ? "New event" : "Event")}
          </h2>
        </Card>

        <SettingsSection title="Details">
          <SettingsRow label="Event">
            <Combobox
              options={canonicalEvents}
              getId={(e) => e.id}
              getLabel={(e) => e.name}
              value={draft.eventText}
              onChange={handleEventTextChange}
              allowFreeText
              locked={locked}
              placeholder="Search or type a custom event name"
            />
          </SettingsRow>

          {categoryName && (
            <SettingsRow label="Category">
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)" }}>
                {categoryName}
              </span>
            </SettingsRow>
          )}

          <SettingsRow label="Division">
            <ButtonGroup
              options={divisions.map((d) => ({ value: d, label: d }))}
              value={draft.division ?? ""}
              onChange={(v) => patch({ division: v as TournamentDivision })}
              locked={locked}
            />
          </SettingsRow>

          <SettingsRow label="Type">
            <ButtonGroup
              options={[{ value: "standard", label: "Standard" }, { value: "trial", label: "Trial" }]}
              value={draft.event_type}
              onChange={(v) => patch({ event_type: v as "standard" | "trial" })}
              locked={locked}
            />
          </SettingsRow>

          {/* An event's *when* is the union of its shifts, so there is
              nothing to edit here — this is the read-out of that. Empty for
              an event on a cosmetic track, which has no schedule at all. */}
          <SettingsRow label="Days" helper="Taken from this event's shifts.">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {current && current.days.length > 0 ? formatDates(current.days) : "—"}
            </span>
          </SettingsRow>

          {/* Adding a shift adds its track automatically; this is how an
              event reaches an undated track (Test Writing) that has no
              shifts to infer it from. */}
          <SettingsRow label="Tracks" helper="Which parts of the tournament this event belongs to.">
            <ButtonGroup
              options={tracks.map((t) => ({ value: String(t.id), label: t.name }))}
              value={draft.trackIds.map(String)}
              onChange={(v) => {
                const id = Number(v);
                patch({
                  trackIds: draft.trackIds.includes(id)
                    ? draft.trackIds.filter((x) => x !== id)
                    : [...draft.trackIds, id],
                });
              }}
              locked={locked}
            />
          </SettingsRow>

          <SettingsRow label="Building">
            <Input fullWidth font="sans" locked={locked} value={draft.building} onChange={(e) => patch({ building: e.target.value })} />
          </SettingsRow>

          <SettingsRow label="Room">
            <Input fullWidth font="sans" locked={locked} value={draft.room} onChange={(e) => patch({ room: e.target.value })} />
          </SettingsRow>

          <SettingsRow label="Floor">
            <Input fullWidth font="sans" locked={locked} value={draft.floor} onChange={(e) => patch({ floor: e.target.value })} />
          </SettingsRow>

          <SettingsRow label="Volunteers needed" last>
            <Input fullWidth charset="numeric" locked={locked} value={draft.volunteers_needed} onChange={(e) => patch({ volunteers_needed: e.target.value })} />
          </SettingsRow>
        </SettingsSection>

        {/* Attaching a shift needs a real event id, so this only shows up
            once the event has been created — matches how the roles editor
            hides its Members tab for an unsaved role. */}
        {!isNew && current && (
          <SettingsSection title="Shifts">
            <SettingsRow label="Shifts" last>
              {/* A list, not chips — shifts can share a label but differ
                  only by time, so each row needs room to show its own
                  start/end (condensed to time-of-day; the event's own
                  date is already shown above). */}
              {current.shifts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: current.shifts.length > 0 ? "10px" : "0" }}>
                  {current.shifts.map((shift) => (
                    <div
                      key={shift.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                        padding: "8px 10px", borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <IconCalendar size={13} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                        <span style={{
                          fontFamily: "var(--font-sans)", fontSize: "13px",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {shift.label}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                          {formatTime(shift.start)}–{formatTime(shift.end)}
                        </span>
                      </div>
                      {!locked && (
                        <Button
                          type="button" variant="ghost" size="xs" iconOnly
                          title="Remove" onClick={() => handleDetachShift(shift.id)}
                        >
                          <IconX size={12} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!locked && (
                  <div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {eligibleShifts.length > 0 && (
                        <Popover
                          trigger={
                            <Button type="button" variant="secondary" size="sm" fullWidth>
                              <IconPlus size={12} /> Add shift
                            </Button>
                          }
                          items={eligibleShifts}
                          getKey={(s) => s.id}
                          renderLabel={(s) => `${s.label} (${formatTime(s.start)}–${formatTime(s.end)})`}
                          onSelect={handleAttachShift}
                          checklist
                          isSelected={() => false}
                          width={280}
                        />
                      )}
                      {/* A new shift needs a track and one of its days, so
                          this only appears once the event is on exactly one
                          track — with none or several there is no answer. */}
                      {newShiftTrack && (
                        <FormPopover
                          width={300}
                          trigger={
                            <Button type="button" variant="secondary" size="sm" fullWidth>
                              <IconPlus size={12} /> New shift
                            </Button>
                          }
                        >
                          {(close) => (
                            <CreateShiftForm
                              tournamentId={tournamentId}
                              trackId={newShiftTrack.id}
                              day={newShiftTrack.start_date ?? ""}
                              days={newShiftDays.length > 1 ? newShiftDays : undefined}
                              onCreated={async (shift) => { await handleCreateAndAttachShift(shift); close(); }}
                              onCancel={close}
                            />
                          )}
                        </FormPopover>
                      )}
                    </div>
                    {/* No existing shift already fits this event's window —
                        point straight at creating one instead of a
                        dead-end "nothing to attach" message. */}
                    {allShifts !== null && eligibleShifts.length === 0 && (
                      <p style={{
                        fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)",
                        marginTop: "8px",
                      }}>
                        {newShiftTrack
                          ? "No shifts left to add — create one above."
                          : "No shifts left to add. Put this event on a single competition day to create one here."}
                      </p>
                    )}
                  </div>
              )}

              {shiftError && (
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginTop: "8px" }}>
                  {shiftError}
                </p>
              )}
            </SettingsRow>
          </SettingsSection>
        )}

        {!locked && !isNew && current && (
          <SettingsSection title="Danger Zone" variant="danger">
            <SettingsRow label="Delete event" helper="This also detaches every shift from it." last contentStyle={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="button" variant="secondary" onClick={() => setShowDelete(true)} style={{ color: "var(--color-danger)" }}>
                <IconTrash size={13} /> Delete
              </Button>
            </SettingsRow>
          </SettingsSection>
        )}
      </div>

      {showDelete && current && (
        <DeleteEventModal
          tournamentId={tournamentId}
          eventId={current.id}
          eventName={draft.eventText || "this event"}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { onDeleted(current.id); onClose(); }}
        />
      )}
    </DockedPanel>
  );
}
