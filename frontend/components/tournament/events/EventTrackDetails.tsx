"use client";

import { type ReactNode, useState } from "react";
import { staffingColor } from "@/components/tournament/assignments/StaffingNeedLine";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { EditableCombobox, EditableSelect, EditableText } from "@/components/ui/EditableText";
import { IconLocation, IconMinus, IconPlus, IconX } from "@/components/ui/Icons";
import { ProgressRing } from "@/components/ui/ProgressRing";
import table from "@/components/ui/Table.module.css";
import type {
  Assignment,
  EventTrackDetail,
  Role,
  TournamentBuilding,
  TournamentTrack,
} from "@/lib/api";
import { staffingFilled } from "@/lib/assignments/staffing";
import { buildingLabel, buildingSubtitle } from "@/lib/buildings";
import {
  chosenStaffing,
  roomFloor,
  type StaffingOption,
  staffingCount,
  staffingGroup,
  staffingKey,
  staffingOptions,
  withStaffingCount,
} from "@/lib/eventTrackDetails";
import { placeOfTrack } from "@/lib/tournamentDisplay";

/**
 * Where an event happens and who it needs, per track — that is how both are
 * stored, since an event on two days has a different room and staffing on
 * each.
 */
/** A track detail as the panel edits it: a building (picked, or a name not
 *  yet created) and room names, which become room ids on save — see
 *  resolveDraftLocations. A building with no rooms saves as unplaced. */
export type DraftTrackDetail = Omit<EventTrackDetail, "room_ids"> & {
  building_id: number | null;
  new_building_name?: string | null;
  room_names: string[];
};

type TrackEntry = { track: TournamentTrack; detail: DraftTrackDetail };

interface SectionProps {
  details: DraftTrackDetail[];
  /** Tracks this viewer hid from the panel (the event_panel display config).
   *  Their details are still in `details` and still saved — only the rows
   *  are dropped from view. */
  hiddenTrackIds: Set<number>;
  /** The full track catalog — used for names and to order the rows. */
  tracks: TournamentTrack[];
  locked: boolean;
  /** One track: its name is the tournament's, so a Track column would be
   *  repeating something the TD already knows. */
  simple: boolean;
  onChange: (details: DraftTrackDetail[]) => void;
}

/** Catalog order, not the order the links came back in — so rows read Day 1,
 *  Day 2 rather than by whenever each link happened to be created. */
function visibleEntries({ details, hiddenTrackIds, tracks }: SectionProps): TrackEntry[] {
  return tracks
    .filter((track) => !hiddenTrackIds.has(track.id))
    .map((track) => ({ track, detail: details.find((d) => d.track_id === track.id) }))
    .filter((entry): entry is TrackEntry => !!entry.detail);
}

function patcher({ details, onChange }: SectionProps) {
  return (trackId: number, updates: Partial<DraftTrackDetail>) =>
    onChange(details.map((d) => (d.track_id === trackId ? { ...d, ...updates } : d)));
}

function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
        color: "var(--color-text-tertiary)",
        margin: "12px 0",
      }}
    >
      {children}
    </p>
  );
}

/**
 * Where the event happens, per competition day it runs on. Editing is local —
 * the caller folds it into its own draft and save bar.
 */
export function EventLocations(props: SectionProps & { buildings: TournamentBuilding[] }) {
  if (props.details.length === 0) {
    return <SectionNote>Add a track above to say where this event happens.</SectionNote>;
  }
  // Only competition days hold a place: buildings are tagged with those alone.
  const placeable = visibleEntries(props).filter(({ track }) => track.is_primary);
  if (placeable.length === 0) {
    return <SectionNote>Only competition days have a location.</SectionNote>;
  }
  return (
    <div style={{ padding: "4px 0 8px" }}>
      <LocationTable
        rows={placeable}
        buildings={props.buildings}
        locked={props.locked}
        showTrack={!props.simple}
        onPatch={patcher(props)}
      />
    </div>
  );
}

/**
 * How many of each role, and how many 18+ / 21+ in any role, the event wants
 * on each track it runs on, beside how many it has. Editing is local, like
 * EventLocations.
 */
export function EventStaffing(
  props: SectionProps & {
    roles: Role[];
    /** The event's assignments, for the Staffed column. Null while loading
     *  or for an event not yet created. */
    assignments: Assignment[] | null;
  },
) {
  if (props.details.length === 0) {
    return <SectionNote>Add a track above to say who this event needs.</SectionNote>;
  }
  const patch = patcher(props);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0 16px" }}>
      {visibleEntries(props).map(({ track, detail }) => (
        <div key={track.id} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {!props.simple && <TrackHeading>{track.name}</TrackHeading>}
          <StaffingTable
            detail={detail}
            roles={props.roles}
            assignments={props.assignments}
            locked={props.locked}
            onPatch={(updates) => patch(track.id, updates)}
          />
        </div>
      ))}
    </div>
  );
}

function TrackHeading({ children }: { children: ReactNode }) {
  return (
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
      {children}
    </span>
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
        gridTemplateColumns: `${showTrack ? "minmax(0, 1fr) " : ""}minmax(0, 1.2fr) 56px minmax(0, 1fr)`,
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
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ ...CELL_TEXT, color: "var(--color-text-secondary)" }}>
                  {track.name}
                </span>
                {/* The track's campus, as context for the building beside it. */}
                {placeOfTrack(track, { short: true }) && (
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
                    <IconLocation size={11} style={{ flexShrink: 0 }} />
                    <span
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {placeOfTrack(track, { short: true })}
                    </span>
                  </span>
                )}
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
 * One track's staffing: a row per need, a role's or an any-role age rule's.
 * Role, Needed and removal are edited in place; Add staffing starts a blank
 * row whose role is picked first.
 */
function StaffingTable({
  detail,
  roles,
  assignments,
  locked,
  onPatch,
}: {
  detail: DraftTrackDetail;
  roles: Role[];
  assignments: Assignment[] | null;
  locked: boolean;
  onPatch: (updates: Partial<DraftTrackDetail>) => void;
}) {
  // The row just added, so its Needed cell opens ready to type.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // A blank row waiting for its role. Nothing is in the draft until one is picked.
  const [adding, setAdding] = useState(false);
  const options = staffingOptions(roles);
  const chosen = chosenStaffing(detail, roles);
  const isChosen = (o: StaffingOption) => chosen.some((c) => staffingKey(c) === staffingKey(o));
  const countOf = (option: StaffingOption) => staffingCount(detail, option);

  function setCount(option: StaffingOption, count: number | null) {
    onPatch(withStaffingCount(detail, option, count));
  }

  function replace(option: StaffingOption, next: StaffingOption) {
    if (staffingKey(next) === staffingKey(option)) return;
    onPatch(withStaffingCount(withStaffingCount(detail, option, null), next, countOf(option)));
  }

  /** What a role cell can pick: anything not on this track yet, plus its own. */
  function choicesFor(ownKey: string | null) {
    return options
      .filter((o) => !isChosen(o) || staffingKey(o) === ownKey)
      .map((o) => ({ label: o.label, group: staffingGroup(o) }));
  }
  const canAdd = options.some((o) => !isChosen(o));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {(chosen.length > 0 || adding) && (
        <div
          className={table.table}
          style={{ gridTemplateColumns: "minmax(0, 1fr) 72px 104px 24px" }}
        >
          <div className={table.header} style={{ position: "static" }}>
            <span>Role</span>
            <span>Staffed</span>
            <span>Needed</span>
            <span />
          </div>
          {chosen.map((option) => {
            const count = countOf(option);
            const filled = assignments
              ? staffingFilled(assignments, option, detail.track_id)
              : null;
            const key = staffingKey(option);
            return (
              <div key={key} className={table.row}>
                <span style={{ display: "flex", alignItems: "baseline", gap: "6px", minWidth: 0 }}>
                  <EditableSelect
                    value={option.label}
                    choices={choicesFor(key)}
                    onSave={(label) => {
                      const next = options.find((o) => o.label === label);
                      if (next) replace(option, next);
                    }}
                    textStyle={CELL_TEXT}
                    locked={locked}
                    title="Change the role"
                  />
                  {option.kind === "age" && (
                    <span
                      style={{ ...CELL_TEXT, fontWeight: 400, color: "var(--color-text-tertiary)" }}
                    >
                      any role
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {filled === null ? (
                    <span style={{ ...DATA_TEXT, color: "var(--color-text-tertiary)" }}>—</span>
                  ) : (
                    <>
                      <ProgressRing
                        completed={filled}
                        total={count}
                        size={12}
                        strokeWidth={16}
                        color={staffingColor(filled, count)}
                      />
                      <span style={DATA_TEXT}>{filled}</span>
                    </>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <EditableText
                    value={String(count)}
                    startEditing={justAdded === key}
                    onSave={(text) => {
                      const next = Number(text.trim());
                      if (!Number.isInteger(next) || next < 1) {
                        throw new Error("Enter a whole number, 1 or more");
                      }
                      setJustAdded(null);
                      setCount(option, next);
                    }}
                    onCancel={() => setJustAdded(null)}
                    textStyle={DATA_TEXT}
                    locked={locked}
                    title={`${option.label} needed`}
                    errorToast
                  />
                  {!locked && (
                    <span className={table.revealOnHover} style={{ gap: "2px" }}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        iconOnly
                        aria-label={`One fewer ${option.label}`}
                        disabled={count <= 1}
                        onClick={() => setCount(option, count - 1)}
                      >
                        <IconMinus size={12} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        iconOnly
                        aria-label={`One more ${option.label}`}
                        onClick={() => setCount(option, count + 1)}
                      >
                        <IconPlus size={12} />
                      </Button>
                    </span>
                  )}
                </span>
                {locked ? (
                  <span />
                ) : (
                  <span className={table.revealOnHover}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      iconOnly
                      aria-label={`Remove ${option.label}`}
                      onClick={() => setCount(option, null)}
                    >
                      <IconX size={12} />
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
          {adding && (
            <div className={table.row}>
              <EditableSelect
                value=""
                placeholder="Role"
                startEditing
                choices={choicesFor(null)}
                onSave={(label) => {
                  const next = options.find((o) => o.label === label);
                  setAdding(false);
                  if (!next) return;
                  setJustAdded(staffingKey(next));
                  setCount(next, 1);
                }}
                onCancel={() => setAdding(false)}
                textStyle={CELL_TEXT}
                title="Pick a role"
              />
              <span style={{ ...DATA_TEXT, color: "var(--color-text-tertiary)" }}>—</span>
              <span style={{ ...DATA_TEXT, color: "var(--color-text-tertiary)" }}>—</span>
              <span />
            </div>
          )}
        </div>
      )}
      {locked
        ? chosen.length === 0 && (
            <span style={{ ...CELL_TEXT, fontWeight: 400, color: "var(--color-text-tertiary)" }}>
              No staffing
            </span>
          )
        : !adding && (
            <Button
              type="button"
              variant="dashed"
              size="xs"
              fullWidth
              disabled={!canAdd}
              title={canAdd ? undefined : "Every role is already on this track"}
              onClick={() => setAdding(true)}
            >
              <IconPlus size={11} /> Add staffing
            </Button>
          )}
    </div>
  );
}

const CELL_TEXT = { fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 } as const;
const DATA_TEXT = { fontFamily: "var(--font-mono)", fontSize: "13px" } as const;

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
