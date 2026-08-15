"use client";

import { useEffect, useMemo, useState } from "react";
import {
  tournamentEventsApi, tournamentShiftsApi, canonicalEventsApi, ApiError,
  TournamentEvent, TournamentEventInput, TournamentShift, CanonicalEvent, TournamentDivision,
} from "@/lib/api";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { toDatetimeLocal, fromDatetimeLocal, formatTime } from "@/lib/timeFormat";
import { SidePanel } from "@/components/ui/SidePanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { DeleteEventModal } from "@/components/tournament/events/DeleteEventModal";
import { IconPlus, IconTrash, IconCalendar, IconX } from "@/components/ui/Icons";

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
  start_time: string;
  end_time: string;
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
    start_time: toDatetimeLocal(event?.start_time ?? null),
    end_time: toDatetimeLocal(event?.end_time ?? null),
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
}

export function EventPanel({ tournamentId, event, locked, onClose, onSaved, onDeleted }: EventPanelProps) {
  const { selectedTournament } = useTournament();
  const divisions = selectedTournament?.division ?? [];
  const { guard } = useUnsavedChanges();
  // start_date/end_date are date-only ("YYYY-MM-DD") — widen to the day's
  // full span so datetime-local min/max don't clip valid times on the
  // boundary days themselves.
  const minDateTime = selectedTournament ? `${selectedTournament.start_date}T00:00` : undefined;
  const maxDateTime = selectedTournament ? `${selectedTournament.end_date}T23:59` : undefined;

  // The event this panel is editing. Starts as `event` (null for "new"),
  // and becomes the real row once a create lands — so the Shifts section
  // can appear without closing the panel.
  const [current, setCurrent] = useState<TournamentEvent | null>(event);
  const [draft, setDraft] = useState<EventDraft>(() => draftFromEvent(event));
  const [canonicalEvents, setCanonicalEvents] = useState<CanonicalEvent[]>([]);
  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [timeErrors, setTimeErrors] = useState<{ start_time?: string; end_time?: string }>({});
  const [showDelete, setShowDelete] = useState(false);
  const [shiftError, setShiftError] = useState<string | undefined>(undefined);

  useEffect(() => {
    canonicalEventsApi.list().then(setCanonicalEvents).catch(() => {});
  }, []);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId).then(setAllShifts).catch(() => setAllShifts([]));
  }, [tournamentId]);

  const isNew = current === null;
  // For a new event this compares against the blank default draft, so an
  // untouched "New event" panel reads as clean — closing it needs no
  // confirmation until the user actually types something.
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFromEvent(current)),
    [draft, current]
  );

  function patch(p: Partial<EventDraft>) {
    setDraft((d) => ({ ...d, ...p }));
    if (p.start_time !== undefined || p.end_time !== undefined) {
      setTimeErrors((cur) => {
        const next = { ...cur };
        if (p.start_time !== undefined) delete next.start_time;
        if (p.end_time !== undefined) delete next.end_time;
        return next;
      });
    }
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
      start_time: fromDatetimeLocal(draft.start_time),
      end_time: fromDatetimeLocal(draft.end_time),
    };
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);
    setTimeErrors({});
    try {
      const payload = buildPayload();
      const saved = isNew
        ? await tournamentEventsApi.create(tournamentId, { ...payload, tournament_id: tournamentId })
        : await tournamentEventsApi.update(tournamentId, current!.id, payload);
      setCurrent(saved);
      setDraft(draftFromEvent(saved));
      onSaved(saved);
    } catch (err) {
      // The bounds check comes back as a 409 naming which field it's about
      // ("... start_time falls before ..." / "... end_time falls after ...")
      // — route it to that Input instead of just the floating bar.
      if (err instanceof ApiError && err.status === 409 && err.message.includes("start_time")) {
        setTimeErrors({ start_time: err.message });
      } else if (err instanceof ApiError && err.status === 409 && err.message.includes("end_time")) {
        setTimeErrors({ end_time: err.message });
      } else {
        setSaveError(err instanceof ApiError ? err.message : "Failed to save event.");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(draftFromEvent(current));
    setSaveError(undefined);
    setTimeErrors({});
    onClose();
  }

  // Only offered once the event has its own saved start/end — attaching
  // against unsaved draft bounds would let a shift through that the
  // backend's own bounds check (against the persisted row) then rejects.
  const eligibleShifts = useMemo(() => {
    if (!allShifts || !current?.start_time || !current?.end_time) return [];
    const attachedIds = new Set(current.shifts.map((s) => s.id));
    return allShifts.filter((s) =>
      !attachedIds.has(s.id) && s.start >= current.start_time! && s.end <= current.end_time!
    );
  }, [allShifts, current]);

  async function handleAttachShift(shift: TournamentShift) {
    if (!current) return;
    setShiftError(undefined);
    try {
      await tournamentShiftsApi.attach(tournamentId, current.id, shift.id);
      const updated = { ...current, shifts: [...current.shifts, shift] };
      setCurrent(updated);
      onSaved(updated);
    } catch (err) {
      setShiftError(err instanceof ApiError ? err.message : "Failed to add shift.");
      throw err;
    }
  }

  async function handleDetachShift(shiftId: number) {
    if (!current) return;
    setShiftError(undefined);
    try {
      await tournamentShiftsApi.detach(tournamentId, current.id, shiftId);
      const updated = { ...current, shifts: current.shifts.filter((s) => s.id !== shiftId) };
      setCurrent(updated);
      onSaved(updated);
    } catch (err) {
      setShiftError(err instanceof ApiError ? err.message : "Failed to detach shift.");
    }
  }

  const categoryName = draft.event_id
    ? (canonicalEvents.find((e) => e.id === draft.event_id)?.category.name ?? current?.event?.category.name)
    : undefined;

  return (
    <SidePanel
      onClose={() => guard(onClose)}
      width={600}
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
            {isNew ? "New event" : draft.eventText || "Event"}
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

          <SettingsRow label="Start">
            <Input
              type="datetime-local" fullWidth locked={locked} value={draft.start_time}
              onChange={(e) => patch({ start_time: e.target.value })}
              error={timeErrors.start_time}
              min={minDateTime}
              max={maxDateTime}
            />
          </SettingsRow>

          <SettingsRow label="End">
            <Input
              type="datetime-local" fullWidth locked={locked} value={draft.end_time}
              onChange={(e) => patch({ end_time: e.target.value })}
              error={timeErrors.end_time}
              min={minDateTime}
              max={maxDateTime}
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
            <SettingsRow
              label="Shifts"
              helper={!current.start_time || !current.end_time ? "Set start/end time and save to add shifts." : undefined}
              last
            >
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
                current.start_time && current.end_time ? (
                  <Popover
                    trigger={
                      <Button type="button" variant="secondary" size="sm" fullWidth>
                        <IconPlus size={12} /> Add shift
                      </Button>
                    }
                    items={eligibleShifts}
                    getKey={(s) => s.id}
                    renderLabel={(s) => `${s.label} (${formatTime(s.start)}–${formatTime(s.end)})`}
                    emptyMessage="No shifts fit within this event's time window."
                    onSelect={handleAttachShift}
                    checklist
                    isSelected={() => false}
                    width={280}
                  />
                ) : (
                  // Shown in place of the Add-shift control, not just left
                  // blank — attaching is bounds-checked against the event's
                  // own start/end, so there's nothing to offer until those
                  // are set.
                  <p style={{
                    fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)",
                    padding: "10px", textAlign: "center",
                    border: "1px dashed var(--color-border)", borderRadius: "var(--radius-md)",
                  }}>
                    Set a start and end time above, then save, to add shifts.
                  </p>
                )
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
    </SidePanel>
  );
}
