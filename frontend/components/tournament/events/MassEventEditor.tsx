"use client";

import { useEffect, useState } from "react";
import {
  tournamentEventsApi, tournamentShiftsApi, ApiError, TournamentEvent, TournamentEventInput, TournamentDivision, TournamentShift,
} from "@/lib/api";
import { toDateInput, fromDayAndTime, formatDayLabel, formatTime } from "@/lib/timeFormat";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { SidePanel } from "@/components/ui/SidePanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/Input";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FormPopover } from "@/components/ui/FormPopover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { CreateShiftForm } from "@/components/tournament/events/CreateShiftForm";
import { IconPlus, IconMinus, IconX } from "@/components/ui/Icons";

// Only fields shared and safe to blanket-apply across arbitrary events —
// name/category/building/room/etc. are per-event enough that mass-editing
// them would almost always be wrong. Day is deliberately excluded too: it
// isn't offered here, only time-of-day, applied against each event's own
// existing date.
interface MassEventDraft {
  division?: TournamentDivision;
  event_type?: "standard" | "trial";
  // Only meaningful once start or end is touched — combined with startTime/
  // endTime to build each event's new start_time/end_time. Not itself a
  // mass-editable field on TournamentEvent (there's no bare "day" column).
  day?: string;
  startTime?: string;
  endTime?: string;
}

interface EventResult {
  event: TournamentEvent;
  error?: string;
}

function ResultsCard({ results }: { results: EventResult[] }) {
  const failureCount = results.filter((r) => r.error).length;
  const successCount = results.length - failureCount;
  return (
    <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        marginBottom: "10px",
      }}>
        {successCount} saved, {failureCount} failed
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {results.map((r) => (
          <p key={r.event.id} style={{ fontFamily: "var(--font-sans)", fontSize: "12px" }}>
            <span style={{ fontWeight: 500 }}>{eventNameWithDivision(r.event)}</span>{" "}
            {r.error ? (
              <span style={{ color: "var(--color-danger)" }}>— {r.error}</span>
            ) : (
              <span style={{ color: "var(--color-success)" }}>— saved</span>
            )}
          </p>
        ))}
      </div>
    </Card>
  );
}

// A pending shift add/remove, shown git-diff style before Save is pressed —
// undoing just drops it back out of the pending set, nothing hits the
// backend until Save.
function ShiftDiffRow({ shift, sign, onUndo }: { shift: TournamentShift; sign: "+" | "-"; onUndo: () => void }) {
  const color = sign === "+" ? "var(--color-success)" : "var(--color-danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color }}>
        {sign} {shift.label} ({formatTime(shift.start)}–{formatTime(shift.end)})
      </span>
      <Button type="button" variant="ghost" size="xs" iconOnly title="Undo" onClick={onUndo}>
        <IconX size={11} />
      </Button>
    </div>
  );
}

interface MassEventEditorProps {
  tournamentId: number;
  events: TournamentEvent[];
  onClose: () => void;
  /** Called once per event that saved successfully, so the caller can patch its local list the same way EventPanel's onSaved does. */
  onSaved: (updated: TournamentEvent) => void;
}

export function MassEventEditor({ tournamentId, events, onClose, onSaved }: MassEventEditorProps) {
  const { selectedTournament, days, isMultiDay } = useTournament();
  const divisions = selectedTournament?.division ?? [];
  const { guard } = useUnsavedChanges();

  const [draft, setDraft] = useState<MassEventDraft>({});
  const [shiftsToAdd, setShiftsToAdd] = useState<Set<number>>(new Set());
  const [shiftsToRemove, setShiftsToRemove] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<EventResult[] | null>(null);

  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId).then(setAllShifts).catch(() => setAllShifts([]));
  }, [tournamentId]);

  // Same day-resolution rule as time-of-day edits: a newly created shift
  // needs exactly one day, so a multi-day tournament with events on
  // different days can't default to "each event's own" the way attaching
  // an existing shift can (that's per-event bounds-checked on the backend
  // instead, hence no day needed there).
  const shiftDayOptions = isMultiDay ? days.map((d) => ({ value: d, label: formatDayLabel(d) })) : undefined;
  const shiftDefaultDay = isMultiDay ? (days[0] ?? "") : (days[0] ?? toDateInput(events[0]?.start_time ?? events[0]?.end_time ?? null));

  // Every shift currently attached to at least one selected event — the
  // only ones "Remove shift" makes sense for.
  const attachedShifts = (() => {
    const byId = new Map<number, TournamentShift>();
    events.forEach((e) => e.shifts.forEach((s) => byId.set(s.id, s)));
    return [...byId.values()];
  })();

  const pendingAddShifts = (allShifts ?? []).filter((s) => shiftsToAdd.has(s.id));
  const pendingRemoveShifts = attachedShifts.filter((s) => shiftsToRemove.has(s.id));

  const isDirty = draft.division !== undefined || draft.event_type !== undefined
    || draft.startTime !== undefined || draft.endTime !== undefined
    || shiftsToAdd.size > 0 || shiftsToRemove.size > 0;

  const touchesTime = draft.startTime !== undefined || draft.endTime !== undefined;

  function addShift(shift: TournamentShift) {
    setShiftsToAdd((prev) => new Set(prev).add(shift.id));
    setShiftsToRemove((prev) => (prev.has(shift.id) ? new Set([...prev].filter((id) => id !== shift.id)) : prev));
  }

  function removeShift(shift: TournamentShift) {
    setShiftsToRemove((prev) => new Set(prev).add(shift.id));
    setShiftsToAdd((prev) => (prev.has(shift.id) ? new Set([...prev].filter((id) => id !== shift.id)) : prev));
  }

  // Explicit day pick wins (needed once any selected event has no date of
  // its own yet); a single-day tournament has only one valid day so it
  // never needs asking; otherwise each event keeps whatever day it already
  // has — mass-editing time-of-day shouldn't silently move an event to a
  // different day than the one it was already scheduled on.
  function resolveDay(event: TournamentEvent): string | null {
    if (draft.day) return draft.day;
    if (!isMultiDay && days[0]) return days[0];
    if (event.start_time) return toDateInput(event.start_time);
    if (event.end_time) return toDateInput(event.end_time);
    return null;
  }

  function handleCancel() {
    setDraft({});
    setShiftsToAdd(new Set());
    setShiftsToRemove(new Set());
    onClose();
  }

  async function handleSave() {
    setSaving(true);
    setResults(null);

    const outcomes = await Promise.allSettled(events.map(async (event) => {
      let current = event;

      const patch: Partial<TournamentEventInput> = {};
      if (draft.division !== undefined) patch.division = draft.division;
      if (draft.event_type !== undefined) patch.event_type = draft.event_type;
      if (touchesTime) {
        const day = resolveDay(event);
        if (!day) throw new Error("No date set on this event — pick a Day above to apply a time change.");
        if (draft.startTime !== undefined) patch.start_time = fromDayAndTime(day, draft.startTime);
        if (draft.endTime !== undefined) patch.end_time = fromDayAndTime(day, draft.endTime);
      }
      if (Object.keys(patch).length > 0) {
        current = await tournamentEventsApi.update(tournamentId, event.id, patch);
      }

      for (const shift of pendingAddShifts) {
        if (current.shifts.some((s) => s.id === shift.id)) continue;
        await tournamentShiftsApi.attach(tournamentId, event.id, shift.id);
        current = { ...current, shifts: [...current.shifts, shift] };
      }
      for (const shiftId of shiftsToRemove) {
        if (!current.shifts.some((s) => s.id === shiftId)) continue;
        await tournamentShiftsApi.detach(tournamentId, event.id, shiftId);
        current = { ...current, shifts: current.shifts.filter((s) => s.id !== shiftId) };
      }

      return current;
    }));

    const nextResults: EventResult[] = [];
    outcomes.forEach((outcome, i) => {
      const event = events[i];
      if (outcome.status === "fulfilled") {
        onSaved(outcome.value);
        nextResults.push({ event: outcome.value });
      } else {
        const err = outcome.reason;
        nextResults.push({ event, error: err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to save." });
      }
    });
    setResults(nextResults);
    setDraft({});
    setShiftsToAdd(new Set());
    setShiftsToRemove(new Set());
    setSaving(false);
  }

  return (
    <SidePanel
      onClose={() => guard(onClose)}
      width={480}
      footer={
        <FloatingSaveBar
          visible={isDirty}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      }
    >
      <div style={{ padding: `20px 28px ${isDirty ? "100px" : "20px"}` }}>
        <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
            Edit {events.length} events
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            Only fields you change below are applied — the rest are left as-is on every selected event.
          </p>
        </Card>

        <SettingsSection title="Fields to apply">
          <SettingsRow label="Division">
            <ButtonGroup
              options={divisions.map((d) => ({ value: d, label: d }))}
              value={draft.division ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, division: v as TournamentDivision }))}
            />
          </SettingsRow>

          <SettingsRow label="Type">
            <ButtonGroup
              options={[{ value: "standard", label: "Standard" }, { value: "trial", label: "Trial" }]}
              value={draft.event_type ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, event_type: v as "standard" | "trial" }))}
            />
          </SettingsRow>

          {touchesTime && isMultiDay && (
            <SettingsRow label="Day" helper="Needed to apply a time change — events keep their own day otherwise.">
              <Dropdown
                value={draft.day ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, day: v || undefined }))}
                options={days.map((d) => ({ value: d, label: formatDayLabel(d) }))}
              />
            </SettingsRow>
          )}

          <SettingsRow label="Start">
            <Input
              type="time" fullWidth
              value={draft.startTime ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value || undefined }))}
            />
          </SettingsRow>

          <SettingsRow label="End" last>
            <Input
              type="time" fullWidth
              value={draft.endTime ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value || undefined }))}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Shifts">
          <div style={{ padding: "20px 0" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconPlus size={12} /> Add shift
                  </Button>
                }
                items={allShifts ?? []}
                getKey={(s) => s.id}
                renderLabel={(s) => `${s.label} (${formatTime(s.start)}–${formatTime(s.end)})`}
                emptyMessage="No shifts exist yet in this tournament."
                onSelect={addShift}
                width={280}
              />
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconMinus size={12} /> Remove shift
                  </Button>
                }
                items={attachedShifts}
                getKey={(s) => s.id}
                renderLabel={(s) => `${s.label} (${formatTime(s.start)}–${formatTime(s.end)})`}
                emptyMessage="None of the selected events have a shift attached."
                onSelect={removeShift}
                width={280}
              />
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
                    day={shiftDefaultDay}
                    dayOptions={shiftDayOptions}
                    onCreated={(shift) => {
                      setAllShifts((prev) => [...(prev ?? []), shift]);
                      addShift(shift);
                      close();
                    }}
                    onCancel={close}
                  />
                )}
              </FormPopover>
            </div>

            {(pendingAddShifts.length > 0 || pendingRemoveShifts.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                {pendingAddShifts.map((s) => (
                  <ShiftDiffRow key={s.id} shift={s} sign="+" onUndo={() => setShiftsToAdd((prev) => new Set([...prev].filter((id) => id !== s.id)))} />
                ))}
                {pendingRemoveShifts.map((s) => (
                  <ShiftDiffRow key={s.id} shift={s} sign="-" onUndo={() => setShiftsToRemove((prev) => new Set([...prev].filter((id) => id !== s.id)))} />
                ))}
              </div>
            )}

            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              Changes above apply when you press Save — adding is bounds-checked per event on the backend, so one outside an event&rsquo;s time window just fails for that event.
            </p>
          </div>
        </SettingsSection>

        {results && <ResultsCard results={results} />}
      </div>
    </SidePanel>
  );
}
