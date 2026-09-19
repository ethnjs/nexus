"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  tournamentEventsApi, buildingsApi, ApiError,
  TournamentEvent, TournamentEventInput, TournamentShift, TournamentTrack, CanonicalEvent, TournamentDivision,
  EventTrackDetail, TournamentBuilding, Role,
} from "@/lib/api";
import { toTrackDetailInput } from "@/lib/eventTrackDetails";
import { EventTrackDetails, type DraftTrackDetail } from "@/components/tournament/events/EventTrackDetails";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import { useTournament, isSimpleMode } from "@/lib/useTournament";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { formatTime } from "@/lib/timeFormat";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";
import { Combobox } from "@/components/ui/Combobox";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { ChipInput } from "@/components/ui/ChipInput";
import { PENDING_TRACK_NOTE, pendingTracks } from "@/components/tournament/PendingTrackBanner";
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
  // The tracks this event runs on, each with where it happens there and how
  // many of each role it wants. Not derived from its shifts: a cosmetic track
  // (Test Writing) has none by construction, so an event that belongs to one
  // can only say so outright.
  //
  // This one field replaced the old trackIds *and* the flat building/room/
  // floor/volunteers_needed, because on the wire it is one whole-set value —
  // see lib/eventTrackDetails.
  trackDetails: DraftTrackDetail[];
}

function draftFromEvent(event: TournamentEvent | null): EventDraft {
  return {
    eventText: event?.event?.name ?? event?.name ?? "",
    event_id: event?.event_id ?? null,
    name: event?.name ?? null,
    division: event?.division ?? null,
    event_type: event?.event_type ?? "standard",
    // Sorted on both levels so the isDirty JSON compare comes out stable —
    // the server has no guaranteed order for either list, and an unsorted
    // round trip would leave an untouched panel reading as dirty.
    trackDetails: (event?.track_details ?? [])
      .map(toTrackDetailInput)
      .sort((a, b) => a.track_id - b.track_id)
      .map((d) => ({ ...d, needs: [...(d.needs ?? [])].sort((x, y) => x.role_id - y.role_id) })),
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
  /** Catalogs, loaded once by the page — the panel remounts per event, so
   *  fetching them here re-requested all three on every arrow press. */
  canonicalEvents: CanonicalEvent[];
  allShifts: TournamentShift[] | null;
  tracks: TournamentTrack[];
  buildings: TournamentBuilding[];
  roles: Role[];
  /** A shift created from this panel, for the page's catalog. */
  onShiftCreated: (shift: TournamentShift) => void;
  /** A building created or tagged from this panel, likewise. */
  onBuildingSaved: (building: TournamentBuilding) => void;
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
  canonicalEvents, allShifts, tracks, buildings, roles, onShiftCreated, onBuildingSaved,
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

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [showDelete, setShowDelete] = useState(false);
  const [shiftError, setShiftError] = useState<string | undefined>(undefined);

  const isNew = current === null;
  // For a new event this compares against the blank default draft, so an
  // untouched "New event" panel reads as clean — closing it needs no
  // confirmation until the user actually types something.
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFromEvent(current)),
    [draft, current]
  );

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  // The list's copy can be stale (a collaborator's edit), so the panel reads
  // its own row on open and whenever the tab regains focus. Applied only while
  // the draft is untouched — a ref, since the response lands after render.
  const dirtyRef = useRef(isDirty);
  useEffect(() => { dirtyRef.current = isDirty; });
  const eventId = event?.id ?? null;
  const [refreshKey, setRefreshKey] = useState(0);
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1), eventId !== null);
  useEffect(() => {
    if (eventId === null) return;
    let active = true;
    tournamentEventsApi.get(tournamentId, eventId)
      .then((fresh) => {
        if (!active || dirtyRef.current) return;
        setCurrent(fresh);
        setDraft(draftFromEvent(fresh));
        onSaved(fresh);
      })
      .catch(() => {});
    return () => { active = false; };
  // onSaved is deliberately left out: a new identity per page render must
  // not refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, eventId, refreshKey]);

  function patch(p: Partial<EventDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function handleEventTextChange(text: string, matched: CanonicalEvent | null) {
    patch({ eventText: text, event_id: matched ? matched.id : null, name: matched ? null : text });
  }

  function buildPayload(trackDetails: EventTrackDetail[]): TournamentEventInput {
    return {
      name: draft.event_id ? null : (draft.name?.trim() || null),
      division: draft.division,
      event_type: draft.event_type,
      event_id: draft.event_id,
      track_details: trackDetails,
    };
  }

  /**
   * Turns every typed-but-uncreated building name into a real building, and
   * returns track details that point at them by id.
   *
   * An existing name is tagged onto the track rather than created again —
   * names are unique per tournament, so a second "Rowland Hall" would 409,
   * and the TD plainly means the same building. The same new name on two
   * tracks is created once and tagged for the second, via `byName`.
   */
  async function resolveNewBuildings(details: DraftTrackDetail[]): Promise<EventTrackDetail[]> {
    const byName = new Map(buildings.map((b) => [b.name.toLowerCase(), b]));
    const resolved: EventTrackDetail[] = [];
    for (const { new_building_name, ...detail } of details) {
      const name = new_building_name?.trim();
      if (!name) { resolved.push(detail); continue; }
      let building = byName.get(name.toLowerCase());
      if (!building) {
        building = await buildingsApi.create(tournamentId, { name, track_ids: [detail.track_id] });
      } else if (!building.track_ids.includes(detail.track_id)) {
        building = await buildingsApi.update(tournamentId, building.id, {
          track_ids: [...building.track_ids, detail.track_id],
        });
      }
      byName.set(building.name.toLowerCase(), building);
      onBuildingSaved(building);
      resolved.push({ ...detail, building_id: building.id });
    }
    return resolved;
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);
    try {
      const trackDetails = await resolveNewBuildings(draft.trackDetails);
      // Point the draft at the new rows before the event save, so if that
      // save fails a retry reuses them instead of creating them again.
      setDraft((d) => ({ ...d, trackDetails }));
      const payload = buildPayload(trackDetails);
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
  // "Cancel" bar (the shifts page) rather than treating Cancel as a second Close.
  function handleCancel() {
    setDraft(draftFromEvent(current));
    setSaveError(undefined);
  }

  // Shifts on a track this event is already on, minus the ones it holds.
  // Not every shift in the tournament: attaching one adds its track
  // server-side, so an unfiltered list would let an event join a track as a
  // side effect of picking a time. Add the track above first.
  const eligibleShifts = useMemo(() => {
    if (!allShifts || !current) return [];
    const attachedIds = new Set(current.shifts.map((s) => s.id));
    const eventTracks = new Set(current.tracks.map((t) => t.id));
    return allShifts.filter((s) => !attachedIds.has(s.id) && eventTracks.has(s.track_id));
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
    onShiftCreated(shift);
    await handleAttachShift(shift);
  }

  async function handleDetachShift(shiftId: number) {
    if (!current) return;
    await setShiftIds(current.shifts.filter((s) => s.id !== shiftId).map((s) => s.id)).catch(() => {});
  }

  // Seeded from the event's own tracks, which the events GET already names —
  // the catalog fetch lands after mount, and chips showed raw ids until then.
  const trackNames = useMemo(
    () => new Map([...(current?.tracks ?? []), ...tracks].map((t) => [t.id, t.name])),
    [current, tracks],
  );
  const pendingTrackNames = useMemo(
    () => new Set(pendingTracks(tracks).map((t) => t.name)),
    [tracks],
  );
  // Advanced tournaments can have same-labeled shifts on different tracks
  // (the backend only forbids duplicates within a track), so the picker
  // needs the track to disambiguate; simple mode has exactly one track, so
  // naming it would be noise.
  const simple = isSimpleMode(tracks);

  // The backend refuses a *new* link to a pending-delete track but allows an
  // existing one to round-trip, so the picker offers exactly that: live
  // tracks, plus any the event already holds.
  const trackIds = useMemo(
    () => draft.trackDetails.map((d) => d.track_id),
    [draft.trackDetails],
  );
  const selectableTracks = useMemo(
    () => tracks.filter((t) => !t.is_archived || trackIds.includes(t.id)),
    [tracks, trackIds],
  );

  /** Adding a track starts it unplaced; removing one takes its location and
   *  its staffing needs with it, which is the point — they described an
   *  arrangement on a day this event no longer runs. */
  function toggleTrack(trackId: number) {
    patch({
      trackDetails: trackIds.includes(trackId)
        ? draft.trackDetails.filter((d) => d.track_id !== trackId)
        : [...draft.trackDetails, { track_id: trackId, building_id: null, floor: null, rooms: [], needs: [] }]
            .sort((a, b) => a.track_id - b.track_id),
    });
  }

  // The competition days a new shift could land on: this event's own tracks.
  // The form picks between them, so several is fine — but a cosmetic track
  // has no dates and can hold no shift, and an unsaved track change isn't
  // attachable yet, so both are filtered out.
  const newShiftTracks = useMemo(
    () => tracks.filter(
      (t) => t.is_primary && !t.is_archived && (current?.tracks ?? []).some((et) => et.id === t.id),
    ),
    [tracks, current],
  );

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

          {/* Adding a shift adds its track automatically; this is how an
              event reaches an undated track (Test Writing) that has no
              shifts to infer it from. */}
          <SettingsRow label="Tracks" last>
            <ChipInput
              value={trackIds.map((id) => trackNames.get(id) ?? String(id))}
              onChange={(names) => patch({
                trackDetails: draft.trackDetails.filter(
                  (d) => names.includes(trackNames.get(d.track_id) ?? String(d.track_id)),
                ),
              })}
              variant="transparent"
              size="sm"
              disableInput
              locked={locked}
              fullWidth
              // A pending-delete track reads as a warning rather than a
              // normal chip: this event is one of the references holding it
              // there, which is not obvious from the name alone.
              getChipStatus={(name) => (pendingTrackNames.has(name) ? "warning" : "default")}
              getChipTooltip={(name) => (pendingTrackNames.has(name) ? PENDING_TRACK_NOTE : undefined)}
              addButton={
                <Popover
                  trigger={
                    <Button type="button" variant="secondary" size="sm" iconOnly title="Add track" style={{ padding: 0, flexShrink: 0 }}>
                      <IconPlus size={14} />
                    </Button>
                  }
                  items={selectableTracks}
                  getKey={(t) => t.id}
                  renderLabel={(t) => t.name}
                  checklist
                  isSelected={(t) => trackIds.includes(t.id)}
                  onSelect={(t) => toggleTrack(t.id)}
                  emptyMessage="No tracks yet."
                  width={280}
                />
              }
            />
          </SettingsRow>

        </SettingsSection>

        <SettingsSection title="Location & staffing">
          <EventTrackDetails
            details={draft.trackDetails}
            tracks={tracks}
            buildings={buildings}
            roles={roles}
            locked={locked}
            simple={simple}
            onChange={(trackDetails) => patch({ trackDetails })}
          />
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
                    {(eligibleShifts.length > 0 || newShiftTracks.length > 0) && (
                      <Popover
                        trigger={
                          <Button type="button" variant="secondary" size="sm" fullWidth>
                            <IconPlus size={12} /> Add shift
                          </Button>
                        }
                        items={eligibleShifts}
                        getKey={(s) => s.id}
                        renderLabel={(s) => (
                          <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.label}
                            </span>
                            {!simple && <Badge style={{ flexShrink: 0 }}>{trackNames.get(s.track_id) ?? ""}</Badge>}
                          </span>
                        )}
                        onSelect={handleAttachShift}
                        checklist
                        isSelected={() => false}
                        width={280}
                        emptyMessage="No shifts left on this event's tracks — create one above."
                        // A new shift needs a track, and the form asks for
                        // one — but only from the tracks this event is
                        // already on, so creating a shift can't quietly move
                        // the event somewhere new.
                        header={newShiftTracks.length > 0 && (
                          <FormPopover
                            width={280}
                            trigger={
                              <Button type="button" variant="secondary" size="sm" fullWidth>
                                <IconPlus size={12} /> New shift
                              </Button>
                            }
                          >
                            {(close) => (
                              <CreateShiftForm
                                tournamentId={tournamentId}
                                tracks={newShiftTracks}
                                onCreated={async (shift) => { await handleCreateAndAttachShift(shift); close(); }}
                                onCancel={close}
                              />
                            )}
                          </FormPopover>
                        )}
                      />
                    )}
                    {/* No competition day on this event yet — the New shift
                        form above has no track to offer, so point at the
                        Tracks field instead of a dead-end popover. */}
                    {allShifts !== null && eligibleShifts.length === 0 && newShiftTracks.length === 0 && (
                      <p style={{
                        fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)",
                        marginTop: "8px",
                      }}>
                        Add a competition day above, and save, to attach shifts from it.
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
          events={[current]}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { onDeleted(current.id); onClose(); }}
        />
      )}
    </DockedPanel>
  );
}
