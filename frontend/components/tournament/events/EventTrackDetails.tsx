"use client";

import { useState, type ReactNode } from "react";
import type {
  EventStaffingNeed, EventTrackDetail, Role, TournamentBuilding, TournamentTrack,
} from "@/lib/api";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { ChipInput } from "@/components/ui/ChipInput";
import { Button } from "@/components/ui/Button";
import styles from "@/components/settings/Settings.module.css";
import { IconPlus, IconTrash } from "@/components/ui/Icons";

/**
 * Where an event happens and how many of each role it wants, per track.
 *
 * One block per track the event runs on, because that is how both are stored:
 * an event on two days holds a different building and a different staffing
 * need on each, and a single set of fields would have to pick one day and
 * quietly misreport the other.
 *
 * Editing is local — the caller folds these into its own draft and save bar,
 * so a location change is saved by the same button as a name change rather
 * than committing under the TD's hands.
 */
/** A track detail as the panel edits it: the wire shape, plus a building
 *  name typed but not yet created. Never sent — see resolveNewBuildings. */
export type DraftTrackDetail = EventTrackDetail & { new_building_name?: string | null };

export function EventTrackDetails({
  details, hiddenTrackIds, tracks, buildings, roles, locked, simple, onChange,
}: {
  details: DraftTrackDetail[];
  /** Tracks this viewer hid from the section (the event_panel display
   *  config). Their details are still in `details` and still saved — only
   *  the block is dropped from view. */
  hiddenTrackIds: Set<number>;
  /** The full track catalog — used for names and to order the blocks. */
  tracks: TournamentTrack[];
  buildings: TournamentBuilding[];
  roles: Role[];
  locked: boolean;
  /** One track: its name is the tournament's, so a heading per block would
   *  be repeating something the TD already knows. */
  simple: boolean;
  onChange: (details: DraftTrackDetail[]) => void;
}) {
  function patchTrack(trackId: number, updates: Partial<DraftTrackDetail>) {
    onChange(details.map((d) => (d.track_id === trackId ? { ...d, ...updates } : d)));
  }

  // Catalog order, not the order the links came back in — so the blocks read
  // Day 1, Day 2 rather than by whenever each link happened to be created.
  const ordered = tracks
    .map((track) => ({ track, detail: details.find((d) => d.track_id === track.id) }))
    .filter((entry): entry is { track: TournamentTrack; detail: DraftTrackDetail } => !!entry.detail);
  const visible = ordered.filter(({ track }) => !hiddenTrackIds.has(track.id));

  if (ordered.length === 0) {
    return (
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", margin: "12px 0" }}>
        Add a track above to say where this event happens and who it needs.
      </p>
    );
  }

  return (
    <div style={{ padding: "4px 0 8px" }}>
      {visible.map(({ track, detail }, index) => {
        const needs = detail.needs ?? [];
        const hasBuilding = detail.building_id != null || !!detail.new_building_name?.trim();
        const usedRoleIds = new Set(needs.map((n) => n.role_id));
        const spare = roles.filter((r) => !usedRoleIds.has(r.id));

        function setNeeds(next: EventStaffingNeed[]) {
          patchTrack(track.id, { needs: next });
        }

        return (
          <div
            key={track.id}
            style={{
              padding: "14px 0",
              // A rule between tracks, not between fields: the track is the
              // unit a TD reads, so that is where the eye needs the break.
              borderTop: index === 0 ? "none" : "1px solid var(--color-border)",
            }}
          >
            {!simple && (
              <div style={{
                fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.07em",
                color: "var(--color-text-tertiary)", marginBottom: "4px",
              }}>
                {track.name}
              </div>
            )}

            {/* Building, floor and rooms side by side — they are one fact,
                "where", read left to right like an address. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", padding: "8px 0" }}>
              <StackedField label="Building" basis="180px" grow={1.3}>
                <BuildingPicker
                  trackId={track.id}
                  buildingId={detail.building_id ?? null}
                  pendingName={detail.new_building_name ?? null}
                  buildings={buildings}
                  locked={locked}
                  onPick={(buildingId) => {
                    if (buildingId === (detail.building_id ?? null) && !detail.new_building_name) return;
                    // Floor and rooms describe a place inside the old building,
                    // so they go with it — same rule as the buildings board.
                    patchTrack(track.id, { building_id: buildingId, new_building_name: null, floor: null, rooms: [] });
                  }}
                  onPickNew={(name) => patchTrack(track.id, {
                    building_id: null,
                    new_building_name: name,
                    // Cleared only when leaving a real building — not on every
                    // keystroke of the new name, which would wipe a floor typed
                    // while the name was still pending.
                    ...(detail.building_id != null ? { floor: null, rooms: [] } : {}),
                  })}
                />
              </StackedField>

              {/* Always rendered, locked until there is a building: hiding
                  them made the row reflow the moment a building was picked.
                  A floor of nowhere is still not a place, so they stay inert
                  rather than accepting input. */}
              <StackedField label="Floor" basis="80px" grow={0.5}>
                <Input
                  size="sm" font="mono" fullWidth placeholder="e.g. 2"
                  locked={locked || !hasBuilding}
                  value={detail.floor ?? ""}
                  // Raw, not trimmed per keystroke — that ate the space in
                  // "2 East" before the E arrived. The backend strips it.
                  onChange={(e) => patchTrack(track.id, { floor: e.target.value || null })}
                />
              </StackedField>

              <StackedField label="Rooms" basis="180px" grow={1.6}>
                {/* The default filled variant, not transparent: an empty
                    transparent field gave no hint it could be typed in. */}
                <ChipInput
                  value={detail.rooms ?? []}
                  onChange={(rooms) => patchTrack(track.id, { rooms })}
                  disabled={!hasBuilding}
                  locked={locked}
                  size="sm"
                  fullWidth
                  placeholder={hasBuilding ? "Type a room, then Enter" : undefined}
                />
              </StackedField>
            </div>

            <DetailRow label="Staffing">
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                {needs.map((need, i) => (
                  <div key={need.role_id} style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Dropdown
                        value={String(need.role_id)}
                        onChange={(v) => setNeeds(needs.map((n, j) => (j === i ? { ...n, role_id: Number(v) } : n)))}
                        // The role it already holds, plus the unused ones —
                        // the same role twice on one track is a 422.
                        options={roles
                          .filter((r) => r.id === need.role_id || !usedRoleIds.has(r.id))
                          .map((r) => ({ value: String(r.id), label: r.label }))}
                        locked={locked}
                        size="sm"
                        fullWidth
                      />
                    </div>
                    <CountInput
                      value={need.count}
                      locked={locked}
                      onCommit={(count) => setNeeds(needs.map((n, j) => (j === i ? { ...n, count } : n)))}
                    />
                    {!locked && (
                      <Button
                        type="button" variant="ghost" size="xs" iconOnly
                        aria-label="Remove"
                        onClick={() => setNeeds(needs.filter((_, j) => j !== i))}
                      >
                        <IconTrash style={{ color: "var(--color-danger)" }} />
                      </Button>
                    )}
                  </div>
                ))}
                {!locked && spare.length > 0 && (
                  <Button
                    type="button" variant="secondary" size="xs"
                    style={{ whiteSpace: "nowrap" }}
                    onClick={() => setNeeds([...needs, { role_id: spare[0].id, count: 1 }])}
                  >
                    <IconPlus size={12} /> Add role
                  </Button>
                )}
              </div>
            </DetailRow>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pick a building for one track, or type a new one.
 *
 * A typed name that matches nothing is held in the draft as
 * `new_building_name` and created when the panel saves — typing it is the
 * whole gesture, with no separate "Create" click. Until then the event has no
 * building id to point at, which is why the name rides alongside instead.
 */
function BuildingPicker({
  trackId, buildingId, pendingName, buildings, locked, onPick, onPickNew,
}: {
  trackId: number;
  buildingId: number | null;
  /** A name typed but not yet created. */
  pendingName: string | null;
  /** Every building in the tournament — the picker narrows to this track. */
  buildings: TournamentBuilding[];
  locked: boolean;
  onPick: (buildingId: number | null) => void;
  onPickNew: (name: string) => void;
}) {
  // Only buildings tagged with this track. The composite FK makes the other
  // pairing impossible, so offering it would be offering a 422.
  const onTrack = buildings.filter((b) => b.track_ids.includes(trackId));
  const display = pendingName ?? buildings.find((b) => b.id === buildingId)?.name ?? "";

  const [text, setText] = useState(display);
  // Adopt a change from outside (Cancel, a refetch, a save landing) during
  // render — the same derived-state pattern CountInput uses.
  const [seen, setSeen] = useState(display);
  if (display !== seen) {
    setSeen(display);
    setText(display);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <Combobox
        options={onTrack}
        getId={(b) => b.id}
        getLabel={(b) => b.name}
        value={text}
        onChange={(next, matched) => {
          setText(next);
          if (matched) onPick(matched.id);
          // Clearing the field is how an event goes back to unplaced.
          else if (!next.trim()) onPick(null);
          // Raw, not trimmed — trimming per keystroke would eat the space in
          // "Rowland Hall" before the H arrived. Trimmed on save instead.
          else onPickNew(next);
        }}
        placeholder={onTrack.length === 0 ? "Type a building name" : "Unplaced"}
        emptyMessage="No buildings yet — type a name to create one"
        locked={locked}
        size="sm"
      />
      {pendingName?.trim() && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
          New building — created when you save
        </span>
      )}
    </div>
  );
}

/**
 * A staffing count. Holds its own text so the field can be empty mid-edit:
 * clamping on every keystroke snapped a cleared "1" straight back to "1", so
 * there was no way to type a "2" over it. Only a valid count (1 or more)
 * reaches the draft; blurring an empty field restores the last one.
 */
function CountInput({ value, locked, onCommit }: {
  value: number;
  locked: boolean;
  onCommit: (count: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Adopt a new value from outside (Cancel, a refetch) during render rather
  // than in an effect — the pattern React recommends for derived state.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(String(value));
  }

  return (
    <Input
      size="sm" charset="numeric" locked={locked}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = Number(e.target.value);
        if (next >= 1) onCommit(next);
      }}
      onBlur={() => { if (!(Number(text) >= 1)) setText(String(value)); }}
      style={{ width: "56px" }}
    />
  );
}

/**
 * One field of a horizontal group, label above control. The label reuses the
 * Details row's own label class, so it matches DetailRow in weight and size.
 * Flex rather than grid so a narrow panel wraps the fields instead of
 * squeezing a building name down to an ellipsis.
 */
function StackedField({ label, basis, grow, children }: {
  label: string;
  basis: string;
  grow: number;
  children: ReactNode;
}) {
  return (
    <div style={{ flex: `${grow} 1 ${basis}`, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
      <div className={styles.rowLabelText}>{label}</div>
      {children}
    </div>
  );
}

/**
 * The Details section's own row, minus its rule. Built from the same classes
 * as SettingsRow so the labels match it in weight and the controls start on
 * the same column — only the border differs, since rules here go between
 * tracks rather than between fields.
 */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`${styles.row} ${styles.rowLast}`} style={{ padding: "8px 0" }}>
      <div className={styles.rowLabel}>
        <div className={styles.rowLabelText}>{label}</div>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}
