"use client";

import { type ReactNode, useState } from "react";
import styles from "@/components/settings/Settings.module.css";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { Dropdown } from "@/components/ui/Dropdown";
import { EditableCombobox, EditableText } from "@/components/ui/EditableText";
import { IconLocation, IconPlus, IconTrash } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import table from "@/components/ui/Table.module.css";
import type {
  EventStaffingNeed,
  EventTrackDetail,
  Role,
  TournamentBuilding,
  TournamentTrack,
} from "@/lib/api";
import { buildingLabel, buildingSubtitle } from "@/lib/buildings";
import { roomFloor } from "@/lib/eventTrackDetails";
import { placeOfTrack } from "@/lib/tournamentDisplay";

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
/** A track detail as the panel edits it: a building (picked, or a name not
 *  yet created) and room names, which become room ids on save — see
 *  resolveDraftLocations. A building with no rooms saves as unplaced. */
export type DraftTrackDetail = Omit<EventTrackDetail, "room_ids"> & {
  building_id: number | null;
  new_building_name?: string | null;
  room_names: string[];
};

export function EventTrackDetails({
  details,
  hiddenTrackIds,
  tracks,
  buildings,
  roles,
  locked,
  simple,
  onChange,
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
    .filter(
      (entry): entry is { track: TournamentTrack; detail: DraftTrackDetail } => !!entry.detail,
    );
  const visible = ordered.filter(({ track }) => !hiddenTrackIds.has(track.id));

  if (ordered.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: "var(--color-text-tertiary)",
          margin: "12px 0",
        }}
      >
        Add a track above to say where this event happens and who it needs.
      </p>
    );
  }

  // Only competition days hold a place: buildings are tagged with those alone.
  const placeable = visible.filter(({ track }) => track.is_primary);

  return (
    <div style={{ padding: "4px 0 8px" }}>
      {placeable.length > 0 && (
        <LocationTable
          rows={placeable}
          buildings={buildings}
          locked={locked}
          showTrack={!simple}
          onPatch={patchTrack}
        />
      )}
      {visible.map(({ track, detail }, index) => {
        const needs = detail.needs ?? [];
        const usedRoleIds = new Set(needs.map((n) => n.role_id));
        const spare = roles.filter((r) => !usedRoleIds.has(r.id));

        function setNeeds(next: EventStaffingNeed[]) {
          patchTrack(track.id, { needs: next });
        }

        // The track's campus, as context for the building picked below.
        // A cosmetic (non-competition-day) track has no place to show.
        const venue = track.is_primary ? placeOfTrack(track) : null;

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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                  marginBottom: "4px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  {track.name}
                </span>
                {venue && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontFamily: "var(--font-sans)",
                      fontSize: "11px",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    <IconLocation size={12} />
                    {venue}
                  </span>
                )}
              </div>
            )}

            <DetailRow label="Staffing">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  alignItems: "flex-end",
                }}
              >
                {needs.map((need, i) => (
                  <div
                    key={need.role_id}
                    style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Dropdown
                        value={String(need.role_id)}
                        onChange={(v) =>
                          setNeeds(
                            needs.map((n, j) => (j === i ? { ...n, role_id: Number(v) } : n)),
                          )
                        }
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
                      onCommit={(count) =>
                        setNeeds(needs.map((n, j) => (j === i ? { ...n, count } : n)))
                      }
                    />
                    {!locked && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        iconOnly
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
                    type="button"
                    variant="secondary"
                    size="xs"
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
 * Where the event is on each competition day: one row per day, each cell
 * edited in place. Edits go to the draft, saved with the rest of the panel.
 *
 * A building name that matches nothing is held as `new_building_name` and
 * created on save (see resolveDraftLocations); typing it is the whole gesture.
 */
function LocationTable({
  rows,
  buildings,
  locked,
  showTrack,
  onPatch,
}: {
  rows: { track: TournamentTrack; detail: DraftTrackDetail }[];
  /** Every building in the tournament; each row offers its own track's. */
  buildings: TournamentBuilding[];
  locked: boolean;
  /** Off with one track, whose name is the tournament's. */
  showTrack: boolean;
  onPatch: (trackId: number, updates: Partial<DraftTrackDetail>) => void;
}) {
  return (
    <div
      className={table.table}
      style={{
        gridTemplateColumns: `${showTrack ? "minmax(0, 1fr) " : ""}minmax(0, 1.2fr) 56px minmax(0, 2fr)`,
        marginBottom: "4px",
      }}
    >
      <div className={table.header} style={{ position: "static" }}>
        {showTrack && <span>Track</span>}
        <span>Building</span>
        <span>Floor</span>
        <span>Rooms</span>
      </div>
      {rows.map(({ track, detail }) => {
        const onTrack = buildings.filter((b) => b.track_ids.includes(track.id));
        const building = buildings.find((b) => b.id === detail.building_id);
        const pending = detail.new_building_name?.trim() || null;
        const hasBuilding = !!building || !!pending;
        return (
          <div key={track.id} className={table.row}>
            {showTrack && (
              <span style={{ ...CELL_TEXT, color: "var(--color-text-secondary)" }}>
                {track.name}
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
              <EditableCombobox
                value={pending ?? (building ? buildingLabel(building) : "")}
                placeholder="None"
                suggestions={onTrack.map(buildingLabel)}
                suggestionSubtitle={(label) => buildingSubtitle(onTrack, label)}
                onSave={(text) => {
                  const name = text.trim();
                  const match = name
                    ? onTrack.find(
                        (b) =>
                          b.name.toLowerCase() === name.toLowerCase() ||
                          b.short_name?.toLowerCase() === name.toLowerCase(),
                      )
                    : undefined;
                  if (match?.id === detail.building_id && !pending) return;
                  // Floor and rooms describe a place inside the old building,
                  // so they go with it. Clearing the name unplaces the event.
                  onPatch(track.id, {
                    building_id: match?.id ?? null,
                    new_building_name: match || !name ? null : name,
                    floor: null,
                    room_names: [],
                  });
                }}
                textStyle={CELL_TEXT}
                locked={locked}
                title="Building: its name or short name; a new name is created on save"
                allowEmpty
              />
              {pending && <Badge>New</Badge>}
            </span>
            {/* An override: left empty, the floor comes from the first room. */}
            <EditableText
              value={detail.floor ?? ""}
              placeholder={(hasBuilding && draftFloor(detail, buildings)) || "—"}
              onSave={(floor) => onPatch(track.id, { floor: floor.trim() || null })}
              textStyle={{ ...CELL_TEXT, fontWeight: 400 }}
              locked={locked || !hasBuilding}
              title="Floor: taken from the first room unless you type one"
              allowEmpty
            />
            {hasBuilding ? (
              // A room the building doesn't have yet is created on save.
              <ChipInput
                value={detail.room_names}
                onChange={(room_names) => onPatch(track.id, { room_names })}
                locked={locked}
                variant="transparent"
                size="sm"
                fullWidth
                font="sans"
                placeholder="Add room"
                emptyLabel="None"
              />
            ) : (
              <span style={{ ...CELL_TEXT, color: "var(--color-text-tertiary)" }}>None</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A staffing count. Holds its own text so the field can be empty mid-edit:
 * clamping on every keystroke snapped a cleared "1" straight back to "1", so
 * there was no way to type a "2" over it. Only a valid count (1 or more)
 * reaches the draft; blurring an empty field restores the last one.
 */
function CountInput({
  value,
  locked,
  onCommit,
}: {
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
      size="sm"
      charset="numeric"
      locked={locked}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = Number(e.target.value);
        if (next >= 1) onCommit(next);
      }}
      onBlur={() => {
        if (!(Number(text) >= 1)) setText(String(value));
      }}
      style={{ width: "56px" }}
    />
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

const CELL_TEXT = { fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 } as const;

/** The floor the server will derive: the first room's, using the building's
 *  override for a room it already has. */
function draftFloor(detail: DraftTrackDetail, buildings: TournamentBuilding[]): string | null {
  const first = detail.room_names[0]?.trim();
  if (!first) return null;
  const known = buildings
    .find((b) => b.id === detail.building_id)
    ?.rooms.find((r) => r.name.toLowerCase() === first.toLowerCase());
  return roomFloor(known ?? { name: first, floor: null });
}
