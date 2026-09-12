"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  tournamentEventsApi, tournamentShiftsApi, tournamentTracksApi, ApiError,
  TournamentEvent, TournamentEventInput, TournamentDivision, TournamentShift, TournamentTrack,
} from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { MassResultsCard } from "@/components/ui/MassResultsCard";
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

// A pending add/remove, shown git-diff style before Save is pressed —
// undoing just drops it back out of the pending set, nothing hits the
// backend until Save. Shared by shifts and tracks: both are whole-set
// properties of an event, applied the same way.
type DiffSign = "+" | "-";

// The badge carries the sign and the colour, so a pending change reads as
// one thing rather than a symbol sitting next to a neutral chip.
function DiffBadge({ sign, children }: { sign: DiffSign; children: ReactNode }) {
  return (
    <Badge variant={sign === "+" ? "confirmed" : "declined"}>
      {sign} {children}
    </Badge>
  );
}

function DiffRow({ label, onUndo }: { label: ReactNode; onUndo: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        {label}
      </span>
      <Button type="button" variant="ghost" size="xs" iconOnly title="Undo" onClick={onUndo}>
        <IconX size={11} />
      </Button>
    </div>
  );
}

// A shift reads as its label plus the competition day it sits on. The time
// range it used to show was the least distinguishing part — several shifts
// share one, and the track is what a TD is actually choosing between.
// `sign` marks this as a pending change rather than a row in a picker, and
// folds the whole shift into one coloured badge — the shift is what's being
// added or removed, not just its track.
function shiftLabel(shift: TournamentShift, trackNames: Map<number, string>, sign?: DiffSign): ReactNode {
  const track = trackNames.get(shift.track_id);
  if (sign) {
    return <DiffBadge sign={sign}>{track ? `${shift.label} (${track})` : shift.label}</DiffBadge>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {shift.label}
      </span>
      {track && <Badge>{track}</Badge>}
    </span>
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
  const [tracksToAdd, setTracksToAdd] = useState<Set<number>>(new Set());
  const [tracksToRemove, setTracksToRemove] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<EventResult[] | null>(null);

  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);
  // Every live track, cosmetic ones included — an event belonging to Test
  // Writing is exactly what the event/track bridge exists for.
  const [allTracks, setAllTracks] = useState<TournamentTrack[]>([]);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId).then(setAllShifts).catch(() => setAllShifts([]));
    tournamentTracksApi.list(tournamentId, { public: true }).then(setAllTracks).catch(() => setAllTracks([]));
  }, [tournamentId]);

  // Every shift currently attached to at least one selected event — the
  // only ones "Remove shift" makes sense for.
  const attachedShifts = (() => {
    const byId = new Map<number, TournamentShift>();
    events.forEach((e) => e.shifts.forEach((s) => byId.set(s.id, s)));
    return [...byId.values()];
  })();

  const trackNames = useMemo(() => new Map(allTracks.map((t) => [t.id, t.name])), [allTracks]);

  const pendingAddShifts = (allShifts ?? []).filter((s) => shiftsToAdd.has(s.id));
  const pendingRemoveShifts = attachedShifts.filter((s) => shiftsToRemove.has(s.id));

  // Every track at least one selected event is on — the only ones "Remove
  // track" makes sense for.
  const attachedTracks = allTracks.filter((t) => events.some((e) => e.tracks.some((et) => et.id === t.id)));
  // Add offers live tracks only — the backend refuses a new link to one that
  // is pending delete. Remove still lists them, since that link exists and
  // dropping it is exactly what unblocks the delete.
  const addableTracks = allTracks.filter((t) => !t.is_archived);
  const pendingAddTracks = allTracks.filter((t) => tracksToAdd.has(t.id));
  const pendingRemoveTracks = attachedTracks.filter((t) => tracksToRemove.has(t.id));

  const isDirty = draft.division !== undefined || draft.event_type !== undefined
    || shiftsToAdd.size > 0 || shiftsToRemove.size > 0
    || tracksToAdd.size > 0 || tracksToRemove.size > 0;

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  function addShift(shift: TournamentShift) {
    setShiftsToAdd((prev) => new Set(prev).add(shift.id));
    setShiftsToRemove((prev) => (prev.has(shift.id) ? new Set([...prev].filter((id) => id !== shift.id)) : prev));
  }

  function removeShift(shift: TournamentShift) {
    setShiftsToRemove((prev) => new Set(prev).add(shift.id));
    setShiftsToAdd((prev) => (prev.has(shift.id) ? new Set([...prev].filter((id) => id !== shift.id)) : prev));
  }

  function addTrack(track: TournamentTrack) {
    setTracksToAdd((prev) => new Set(prev).add(track.id));
    setTracksToRemove((prev) => (prev.has(track.id) ? new Set([...prev].filter((id) => id !== track.id)) : prev));
  }

  function removeTrack(track: TournamentTrack) {
    setTracksToRemove((prev) => new Set(prev).add(track.id));
    setTracksToAdd((prev) => (prev.has(track.id) ? new Set([...prev].filter((id) => id !== track.id)) : prev));
  }

  // Discards the pending changes only — the panel stays open.
  function handleCancel() {
    setDraft({});
    setShiftsToAdd(new Set());
    setShiftsToRemove(new Set());
    setTracksToAdd(new Set());
    setTracksToRemove(new Set());
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
      if (tracksToAdd.size > 0 || tracksToRemove.size > 0) {
        const kept = current.tracks.map((t) => t.id).filter((id) => !tracksToRemove.has(id));
        patch.track_ids = [...new Set([...kept, ...tracksToAdd])];
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
    setTracksToAdd(new Set());
    setTracksToRemove(new Set());
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

        <SettingsSection title="Tracks">
          <div style={{ padding: "20px 0" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconPlus size={12} /> Add track
                  </Button>
                }
                items={addableTracks}
                getKey={(t) => t.id}
                renderLabel={(t) => t.name}
                emptyMessage="No tracks exist yet in this tournament."
                onSelect={addTrack}
                width={280}
              />
              <Popover
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconMinus size={12} /> Remove track
                  </Button>
                }
                items={attachedTracks}
                getKey={(t) => t.id}
                renderLabel={(t) => t.name}
                emptyMessage="None of the selected events are on a track."
                onSelect={removeTrack}
                width={280}
              />
            </div>

            {(pendingAddTracks.length > 0 || pendingRemoveTracks.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                {pendingAddTracks.map((t) => (
                  <DiffRow key={t.id} label={<DiffBadge sign="+">{t.name}</DiffBadge>} onUndo={() => setTracksToAdd((prev) => new Set([...prev].filter((id) => id !== t.id)))} />
                ))}
                {pendingRemoveTracks.map((t) => (
                  <DiffRow key={t.id} label={<DiffBadge sign="-">{t.name}</DiffBadge>} onUndo={() => setTracksToRemove((prev) => new Set([...prev].filter((id) => id !== t.id)))} />
                ))}
              </div>
            )}

            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              Removing a track leaves any shifts on it attached — detach those below if you meant to drop them too.
            </p>
          </div>
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
                renderLabel={(s) => shiftLabel(s, trackNames)}
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
                renderLabel={(s) => shiftLabel(s, trackNames)}
                emptyMessage="None of the selected events have a shift attached."
                onSelect={removeShift}
                width={280}
              />
            </div>

            {(pendingAddShifts.length > 0 || pendingRemoveShifts.length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                {pendingAddShifts.map((s) => (
                  <DiffRow key={s.id} label={shiftLabel(s, trackNames, "+")} onUndo={() => setShiftsToAdd((prev) => new Set([...prev].filter((id) => id !== s.id)))} />
                ))}
                {pendingRemoveShifts.map((s) => (
                  <DiffRow key={s.id} label={shiftLabel(s, trackNames, "-")} onUndo={() => setShiftsToRemove((prev) => new Set([...prev].filter((id) => id !== s.id)))} />
                ))}
              </div>
            )}

            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              Adding a shift also adds its track to the event; removing one never takes the track away.
            </p>
          </div>
        </SettingsSection>

        {results && (
          <MassResultsCard
            results={results.map((r) => ({ key: r.event.id, label: eventNameWithDivision(r.event), error: r.error }))}
          />
        )}
      </div>
    </DockedPanel>
  );
}
