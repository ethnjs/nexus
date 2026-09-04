"use client";

import { useEffect, useState } from "react";
import {
  tournamentEventsApi, tournamentShiftsApi, ApiError, TournamentEvent, TournamentEventInput, TournamentDivision, TournamentShift,
} from "@/lib/api";
import { formatTime } from "@/lib/timeFormat";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconPlus, IconMinus, IconX } from "@/components/ui/Icons";

// Only fields shared and safe to blanket-apply across arbitrary events —
// name/category/building/room/etc. are per-event enough that mass-editing
// them would almost always be wrong. Day is deliberately excluded too: it
// isn't offered here, only time-of-day, applied against each event's own
// existing date.
// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MASS_EVENT_EDITOR_WIDTH = 480;

// No times here any more: an event's schedule *is* its shifts, so the way to
// move several events is to change which shifts they hold.
interface MassEventDraft {
  division?: TournamentDivision;
  event_type?: "standard" | "trial";
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
  /** Lets the owning table block selection changes while this panel is dirty. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function MassEventEditor({ tournamentId, events, onClose, onSaved, onDirtyChange }: MassEventEditorProps) {
  const { selectedTournament } = useTournament();
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
    || shiftsToAdd.size > 0 || shiftsToRemove.size > 0;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  function addShift(shift: TournamentShift) {
    setShiftsToAdd((prev) => new Set(prev).add(shift.id));
    setShiftsToRemove((prev) => (prev.has(shift.id) ? new Set([...prev].filter((id) => id !== shift.id)) : prev));
  }

  function removeShift(shift: TournamentShift) {
    setShiftsToRemove((prev) => new Set(prev).add(shift.id));
    setShiftsToAdd((prev) => (prev.has(shift.id) ? new Set([...prev].filter((id) => id !== shift.id)) : prev));
  }

  // Discards the pending changes only — the panel stays open.
  function handleCancel() {
    setDraft({});
    setShiftsToAdd(new Set());
    setShiftsToRemove(new Set());
  }

  async function handleSave() {
    setSaving(true);
    setResults(null);

    const outcomes = await Promise.allSettled(events.map(async (event) => {
      let current = event;

      const patch: Partial<TournamentEventInput> = {};
      if (draft.division !== undefined) patch.division = draft.division;
      if (draft.event_type !== undefined) patch.event_type = draft.event_type;

      // Shifts are a property of the event and set whole-set, so the pending
      // adds and removes fold into the same PATCH — one request per event
      // instead of one per link, and the two can never half-apply.
      if (shiftsToAdd.size > 0 || shiftsToRemove.size > 0) {
        const kept = current.shifts.map((s) => s.id).filter((id) => !shiftsToRemove.has(id));
        patch.shift_ids = [...new Set([...kept, ...shiftsToAdd])];
      }

      if (Object.keys(patch).length > 0) {
        current = await tournamentEventsApi.update(tournamentId, event.id, patch);
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
    <DockedPanel
      onClose={() => guard(onClose)}
      width={MASS_EVENT_EDITOR_WIDTH}
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

          <SettingsRow label="Type" last>
            <ButtonGroup
              options={[{ value: "standard", label: "Standard" }, { value: "trial", label: "Trial" }]}
              value={draft.event_type ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, event_type: v as "standard" | "trial" }))}
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
              Changes above apply when you press Save. Adding a shift also adds its track to the event; removing one never takes the track away.
            </p>
          </div>
        </SettingsSection>

        {results && <ResultsCard results={results} />}
      </div>
    </DockedPanel>
  );
}
