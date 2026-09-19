"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  tournamentEventsApi, tournamentShiftsApi, tournamentTracksApi, rolesApi, ApiError,
  TournamentEvent, TournamentEventInput, TournamentDivision, TournamentShift, TournamentTrack, Role,
} from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { toTrackDetailInput } from "@/lib/eventTrackDetails";
import { useTournament } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { FormPopover } from "@/components/ui/FormPopover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { MassResultsCard, type MassNote } from "@/components/ui/MassResultsCard";
import { Dropdown } from "@/components/ui/Dropdown";
import { Input } from "@/components/ui/Input";
import { TrackPicker } from "@/components/tournament/TrackPicker";
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
  notes?: MassNote[];
}

/** A pending staffing change on one track. Keyed by `${trackId}:${roleId}`,
 *  so setting the same role on the same track twice keeps only the last. */
interface NeedChange {
  trackId: number;
  roleId: number;
  /** Only on a set. */
  count?: number;
}

const needKey = (trackId: number, roleId: number) => `${trackId}:${roleId}`;

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
  const [needsToSet, setNeedsToSet] = useState<Map<string, NeedChange>>(new Map());
  const [needsToRemove, setNeedsToRemove] = useState<Map<string, NeedChange>>(new Map());
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<EventResult[] | null>(null);

  const [allShifts, setAllShifts] = useState<TournamentShift[] | null>(null);
  // Every live track, cosmetic ones included — an event belonging to Test
  // Writing is exactly what the event/track bridge exists for.
  const [allTracks, setAllTracks] = useState<TournamentTrack[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    tournamentShiftsApi.list(tournamentId).then(setAllShifts).catch(() => setAllShifts([]));
    tournamentTracksApi.list(tournamentId, { public: true }).then(setAllTracks).catch(() => setAllTracks([]));
    rolesApi.list(tournamentId).then(setRoles).catch(() => setRoles([]));
  }, [tournamentId]);

  const roleNames = useMemo(() => new Map(roles.map((r) => [r.id, r.label])), [roles]);

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
    || tracksToAdd.size > 0 || tracksToRemove.size > 0
    || needsToSet.size > 0 || needsToRemove.size > 0;

  // A diff row names its track only when there is more than one to confuse
  // it with — same rule as the event panel's shift badges.
  const showTrackInDiff = addableTracks.length > 1;
  function needLabel(change: NeedChange): string {
    const role = roleNames.get(change.roleId) ?? "Role";
    const count = change.count !== undefined ? ` × ${change.count}` : "";
    const track = showTrackInDiff ? ` (${trackNames.get(change.trackId) ?? "track"})` : "";
    return `${role}${count}${track}`;
  }

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

  // Staging the same role on the same track again replaces the earlier
  // change, and a set and a remove for it cancel each other out.
  function setNeed(change: NeedChange) {
    const key = needKey(change.trackId, change.roleId);
    setNeedsToSet((prev) => new Map(prev).set(key, change));
    setNeedsToRemove((prev) => { const next = new Map(prev); next.delete(key); return next; });
  }

  function removeNeed(change: NeedChange) {
    const key = needKey(change.trackId, change.roleId);
    setNeedsToRemove((prev) => new Map(prev).set(key, { trackId: change.trackId, roleId: change.roleId }));
    setNeedsToSet((prev) => { const next = new Map(prev); next.delete(key); return next; });
  }

  // Discards the pending changes only — the panel stays open.
  function handleCancel() {
    setDraft({});
    setShiftsToAdd(new Set());
    setShiftsToRemove(new Set());
    setTracksToAdd(new Set());
    setTracksToRemove(new Set());
    setNeedsToSet(new Map());
    setNeedsToRemove(new Map());
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
      // track_details replaced track_ids, and it is whole-set: every entry
      // the event keeps has to be resent in full, needs included, or the
      // PATCH clears them. Tracks and staffing both edit this one list, so
      // it is built once — track changes first, so staffing a track added in
      // this same save counts that track as one the event is on.
      let details = current.track_details.map(toTrackDetailInput);
      let detailsChanged = false;
      if (tracksToAdd.size > 0 || tracksToRemove.size > 0) {
        details = details.filter((d) => !tracksToRemove.has(d.track_id));
        const keptIds = new Set(details.map((d) => d.track_id));
        details = [
          ...details,
          ...[...tracksToAdd]
            .filter((id) => !keptIds.has(id))
            .map((id) => ({ track_id: id, building_id: null, floor: null, rooms: [], needs: [] })),
        ];
        detailsChanged = true;
      }

      const notes: MassNote[] = [];
      const staffTracks = new Set(
        [...needsToSet.values(), ...needsToRemove.values()].map((c) => c.trackId),
      );
      for (const trackId of staffTracks) {
        const trackName = trackNames.get(trackId) ?? "that track";
        const detail = details.find((d) => d.track_id === trackId);
        // Skipped, not joined to the track: staffing a day an event doesn't
        // run is almost always a mis-selection, and adding the track is one
        // click in the Tracks section above.
        if (!detail) {
          notes.push({ text: `staffing skipped — not on ${trackName}`, tone: "muted" });
          continue;
        }
        let needs = [...(detail.needs ?? [])];
        for (const change of needsToSet.values()) {
          if (change.trackId !== trackId || change.count === undefined) continue;
          // Upsert: the new count wins whatever the event had before.
          const at = needs.findIndex((n) => n.role_id === change.roleId);
          if (at >= 0) needs[at] = { ...needs[at], count: change.count };
          else needs.push({ role_id: change.roleId, count: change.count });
        }
        for (const change of needsToRemove.values()) {
          if (change.trackId !== trackId) continue;
          if (needs.some((n) => n.role_id === change.roleId)) {
            needs = needs.filter((n) => n.role_id !== change.roleId);
          } else {
            notes.push({ text: `no ${roleNames.get(change.roleId) ?? "role"} on ${trackName} to remove`, tone: "danger" });
          }
        }
        details = details.map((d) => (d.track_id === trackId ? { ...d, needs } : d));
        detailsChanged = true;
      }
      if (detailsChanged) patch.track_details = details;

      if (Object.keys(patch).length > 0) {
        current = await tournamentEventsApi.update(tournamentId, event.id, patch);
      }

      return { event: current, notes };
    }));

    const nextResults: EventResult[] = [];
    outcomes.forEach((outcome, i) => {
      const event = events[i];
      if (outcome.status === "fulfilled") {
        onSaved(outcome.value.event);
        nextResults.push({ event: outcome.value.event, notes: outcome.value.notes });
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
    setNeedsToSet(new Map());
    setNeedsToRemove(new Map());
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

        <SettingsSection title="Staffing">
          <div style={{ padding: "20px 0" }}>
            {/* Popover forms, like the Add/Remove buttons above: the track,
                role and count only say what to stage, so they live inside
                the step that stages it rather than as loose fields that look
                like edits but mark nothing as changed. */}
            <div style={{ display: "flex", gap: "8px" }}>
              <FormPopover
                align="left"
                width={300}
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconPlus size={12} /> Set role
                  </Button>
                }
              >
                {(close) => (
                  <NeedForm
                    mode="set"
                    tracks={addableTracks}
                    roles={roles}
                    onSubmit={(change) => { setNeed(change); close(); }}
                    onCancel={close}
                  />
                )}
              </FormPopover>
              <FormPopover
                width={300}
                trigger={
                  <Button type="button" variant="secondary" size="sm" fullWidth>
                    <IconMinus size={12} /> Remove role
                  </Button>
                }
              >
                {(close) => (
                  <NeedForm
                    mode="remove"
                    tracks={addableTracks}
                    roles={roles}
                    onSubmit={(change) => { removeNeed(change); close(); }}
                    onCancel={close}
                  />
                )}
              </FormPopover>
            </div>

            {(needsToSet.size > 0 || needsToRemove.size > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                {[...needsToSet.entries()].map(([key, change]) => (
                  <DiffRow
                    key={key}
                    label={<DiffBadge sign="+">{needLabel(change)}</DiffBadge>}
                    onUndo={() => setNeedsToSet((prev) => { const next = new Map(prev); next.delete(key); return next; })}
                  />
                ))}
                {[...needsToRemove.entries()].map(([key, change]) => (
                  <DiffRow
                    key={key}
                    label={<DiffBadge sign="-">{needLabel(change)}</DiffBadge>}
                    onUndo={() => setNeedsToRemove((prev) => { const next = new Map(prev); next.delete(key); return next; })}
                  />
                ))}
              </div>
            )}

            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              Set adds the role or overwrites its count. Events not on the track are skipped.
            </p>
          </div>
        </SettingsSection>

        {results && (
          <MassResultsCard
            results={results.map((r) => ({
              key: r.event.id, label: eventNameWithDivision(r.event), error: r.error, notes: r.notes,
            }))}
          />
        )}
      </div>
    </DockedPanel>
  );
}


/**
 * One staffing change, staged from a popover: which track, which role, and
 * (for a set) how many. Holds its own state, so every open starts clean and
 * nothing here counts as a change until the TD confirms it.
 */
function NeedForm({ mode, tracks, roles, onSubmit, onCancel }: {
  mode: "set" | "remove";
  tracks: TournamentTrack[];
  roles: Role[];
  onSubmit: (change: NeedChange) => void;
  onCancel: () => void;
}) {
  const [trackId, setTrackId] = useState<number | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [count, setCount] = useState("1");
  const valid = trackId !== null && roleId !== null && (mode === "remove" || Number(count) >= 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Fills itself in and locks when there is one track to pick. */}
      <TrackPicker label="Track" size="sm" fullWidth value={trackId} onChange={setTrackId} tracks={tracks} />
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Dropdown
            label="Role"
            value={roleId !== null ? String(roleId) : ""}
            onChange={(v) => setRoleId(Number(v))}
            options={roles.map((r) => ({ value: String(r.id), label: r.label }))}
            placeholder="Select a role"
            size="sm"
            fullWidth
          />
        </div>
        {mode === "set" && (
          <Input
            label="Count" size="sm" charset="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            style={{ width: "64px" }}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          type="button" variant="primary" size="sm" disabled={!valid}
          onClick={() => valid && onSubmit({
            trackId: trackId!, roleId: roleId!,
            ...(mode === "set" ? { count: Number(count) } : {}),
          })}
        >
          {mode === "set" ? "Set" : "Remove"}
        </Button>
      </div>
    </div>
  );
}
