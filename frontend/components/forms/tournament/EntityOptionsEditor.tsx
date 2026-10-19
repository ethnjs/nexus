"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type EditableOption,
  newOption,
  OptionsEditor,
} from "@/components/forms/builder/OptionsEditor";
import { EventOptionsPickerModal } from "@/components/forms/tournament/EventOptionsPickerModal";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { ChipInput } from "@/components/ui/ChipInput";
import { IconPlus, IconSearch } from "@/components/ui/Icons";
import { PillMenu, type PillTone } from "@/components/ui/PillMenu";
import {
  ApiError,
  type FormQuestionType,
  type Tournament,
  type TournamentEvent,
  type TournamentShift,
  type TournamentTrack,
  type TrackStatus,
  type TrackStatusAssignment,
  tournamentEventsApi,
  tournamentShiftsApi,
  tournamentTracksApi,
} from "@/lib/api";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import type { BranchTarget } from "@/lib/forms/branching";
import { formatDayLabel, formatTime, toDateInput } from "@/lib/timeFormat";

type EntityFieldKey = "availability" | "event_preference" | "track_status";
type Entity = TournamentShift | TournamentEvent;

// An entity-backed option's starting shape — value is a to-be-filled id
// array, not freeform text (see isEntityBackedPreset).
export function newEntityOption(): EditableOption {
  return { ...newOption(), value: [] };
}

interface EntityOptionsEditorProps {
  fieldKey: EntityFieldKey;
  /** The track named in the field's own key — every reserved key but
      track_status carries one. It scopes what the pickers may offer: a
      shift from another track would be written into this track's
      availability pool, and an event that doesn't run on the track has no
      preference to express. Null while the key is still a bare sentinel. */
  trackId?: number | null;
  tournament: Tournament;
  questionType: FormQuestionType;
  options: EditableOption[];
  onChange: (options: EditableOption[]) => void;
  displayStyle?: "list" | "buttons";
  branchTargets?: BranchTarget[];
  errors?: string[];
  trackStatusEnabled?: boolean;
  /** Forwarded to OptionsEditor — whether archiving an option is offered
      alongside removing it. */
  allowArchive?: boolean;
  /** Called when a picker is used before the question has a track. Opens the
      preset popover, which is where the missing track is both reported and
      fixed — so the pickers don't restate the error in a second place. */
  onRequireTrack?: () => void;
}

const STATUS_OPTIONS: { value: TrackStatus; label: string }[] = [
  { value: "interested", label: "Interested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "declined", label: "Declined" },
];
const STATUS_LABEL: Record<TrackStatus | "", string> = {
  "": "Set status",
  interested: "Interested",
  confirmed: "Confirmed",
  declined: "Declined",
};

function entityLabel(
  fieldKey: Exclude<EntityFieldKey, "track_status">,
  entity: Entity,
  isMultiDay: boolean,
): string {
  if (fieldKey === "availability") {
    const shift = entity as TournamentShift;
    return isMultiDay
      ? `${shift.label} (${formatDayLabel(toDateInput(shift.start))})`
      : `${shift.label} (${formatTime(shift.start)}-${formatTime(shift.end)})`;
  }
  return eventNameWithDivision(entity as TournamentEvent);
}

function entityTooltip(
  fieldKey: Exclude<EntityFieldKey, "track_status">,
  entity: Entity,
  isMultiDay: boolean,
): string | undefined {
  if (fieldKey !== "availability" || !isMultiDay) return undefined;
  const shift = entity as TournamentShift;
  return `${formatTime(shift.start)}-${formatTime(shift.end)}`;
}

function entityPickerLabel(
  fieldKey: Exclude<EntityFieldKey, "track_status">,
  entity: Entity,
  isMultiDay: boolean,
): string {
  if (fieldKey === "availability") {
    const shift = entity as TournamentShift;
    const time = `${formatTime(shift.start)}-${formatTime(shift.end)}`;
    return isMultiDay
      ? `${shift.label} (${formatDayLabel(toDateInput(shift.start))}, ${time})`
      : `${shift.label} (${time})`;
  }
  return eventNameWithDivision(entity as TournamentEvent);
}

function assignmentsFor(option: EditableOption): TrackStatusAssignment[] {
  return Array.isArray(option.value) ? (option.value as TrackStatusAssignment[]) : [];
}

/** The status an opted-in availability option sets on the field's own track. */
function statusFor(option: EditableOption): TrackStatus | "" {
  return typeof option.value === "object" && !Array.isArray(option.value)
    ? ((option.value.track_status ?? "") as TrackStatus | "")
    : "";
}

function shiftIdsFor(option: EditableOption): number[] {
  if (typeof option.value === "object" && !Array.isArray(option.value)) {
    return option.value.shift_ids ?? [];
  }
  return Array.isArray(option.value) ? (option.value as number[]) : [];
}

// Shared options editor for entity-backed presets and Track Status. The only
// difference is whether the row also has a shift/event picker; track chips
// live here for both Track Status and opted-in Availability fields.
export function EntityOptionsEditor({
  fieldKey,
  trackId = null,
  tournament,
  questionType,
  options,
  onChange,
  displayStyle,
  branchTargets,
  errors,
  trackStatusEnabled = false,
  allowArchive = false,
  onRequireTrack,
}: EntityOptionsEditorProps) {
  const isEntity = fieldKey !== "track_status";
  const hasTracks = fieldKey === "track_status" || trackStatusEnabled;
  const [entities, setEntities] = useState<Entity[] | null>(isEntity ? null : []);
  // Fetched here rather than inside TrackPicker: that renders once per
  // option, so a field with eight choices was making eight identical
  // requests for the same catalog.
  const [tracks, setTracks] = useState<TournamentTrack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const existingEventIds = useMemo(
    () =>
      new Set(
        options.flatMap((option) => (fieldKey === "event_preference" ? shiftIdsFor(option) : [])),
      ),
    [fieldKey, options],
  );

  useEffect(() => {
    // Also fetched for availability, which needs only its own track's name
    // for the status row — one request either way.
    if (!hasTracks) return;
    tournamentTracksApi
      .list(tournament.id, { public: true })
      .then(setTracks)
      .catch(() => {});
  }, [hasTracks, tournament.id]);

  const trackName =
    trackId !== null ? tracks.find((track) => track.id === trackId)?.name : undefined;
  // An entity-backed question draws its options from one track's catalog, so
  // there is nothing to pick from until the preset names one.
  const trackMissing = isEntity && trackId === null;

  // A shift or event that isn't on this question's track can't be offered:
  // the backend rejects the option outright. One already picked stays as a
  // danger chip (a duplicate moved to another track, say) until the TD
  // removes it, rather than being dropped behind their back.
  function offTrackReason(entity: Entity): string | undefined {
    if (!isEntity || trackId === null) return undefined;
    const onTrack =
      fieldKey === "availability"
        ? (entity as TournamentShift).track_id === trackId
        : (entity as TournamentEvent).tracks.some((track) => track.id === trackId);
    return onTrack ? undefined : "Not on this track";
  }

  useEffect(() => {
    if (!isEntity) return;
    // The whole catalog, not just this track's: picks from another track
    // still have to render (see offTrackReason).
    const list =
      fieldKey === "availability"
        ? tournamentShiftsApi.list(tournament.id)
        : tournamentEventsApi.list(tournament.id);
    list
      .then(setEntities)
      .catch((error) =>
        setLoadError(
          error instanceof ApiError
            ? error.message
            : `Failed to load ${fieldKey === "availability" ? "shifts" : "events"}.`,
        ),
      );
  }, [fieldKey, isEntity, tournament.id]);

  function withEntityIds(option: EditableOption, ids: number[]): EditableOption {
    return fieldKey === "availability" && trackStatusEnabled
      ? { ...option, value: { shift_ids: ids, track_status: statusFor(option) } }
      : { ...option, value: ids };
  }

  function toggleEntity(clientKey: string, entityId: number) {
    onChange(
      options.map((option) => {
        if (option.clientKey !== clientKey) return option;
        const ids = shiftIdsFor(option);
        return withEntityIds(
          option,
          ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId],
        );
      }),
    );
  }

  const loading = entities === null;
  const loaded = entities ?? [];
  const noun = fieldKey === "availability" ? "shifts" : "events";
  // Archived options count too: the backend validates every option it stores.
  const offTrackIds = new Set(
    loaded.filter((entity) => offTrackReason(entity)).map((entity) => entity.id),
  );
  const offTrackPickCount = isEntity
    ? options.reduce(
        (count, option) => count + shiftIdsFor(option).filter((id) => offTrackIds.has(id)).length,
        0,
      )
    : 0;

  function removeOffTrackPicks() {
    onChange(
      options.map((option) => {
        const ids = shiftIdsFor(option);
        const kept = ids.filter((id) => !offTrackIds.has(id));
        return kept.length === ids.length ? option : withEntityIds(option, kept);
      }),
    );
  }
  const emptyMessage = loading
    ? `Loading ${noun}...`
    : fieldKey === "availability"
      ? "No shifts on this tournament yet - add some under Events > Shifts."
      : "No events on this tournament yet - add some under Events.";

  return (
    <>
      {loadError && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-danger)",
            marginBottom: "8px",
          }}
        >
          {loadError}
        </p>
      )}
      {offTrackPickCount > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <Banner
            variant="error"
            message={`${offTrackPickCount} ${offTrackPickCount === 1 ? noun.slice(0, -1) : noun} ${offTrackPickCount === 1 ? "isn't" : "aren't"} on ${trackName ?? "this question's track"}.`}
            action={
              <Button type="button" variant="secondary" size="xs" onClick={removeOffTrackPicks}>
                Remove {offTrackPickCount === 1 ? "it" : "them"}
              </Button>
            }
          />
        </div>
      )}
      <OptionsEditor
        options={options}
        onChange={onChange}
        allowArchive={allowArchive}
        questionType={questionType}
        createOption={isEntity ? newEntityOption : undefined}
        syncValueWithLabel={false}
        displayStyle={displayStyle}
        branchTargets={branchTargets}
        errors={errors}
        renderExtra={(option) => (
          <>
            {isEntity && (
              <EntityPicker
                selectedIds={shiftIdsFor(option)}
                entities={loaded}
                // Another track's shifts are left out of the list entirely —
                // a multi-day tournament has too many to show greyed out.
                pickable={
                  fieldKey === "availability"
                    ? loaded.filter((entity) => !offTrackReason(entity))
                    : loaded
                }
                fieldKey={fieldKey as Exclude<EntityFieldKey, "track_status">}
                isMultiDay={tournament.is_multi_day}
                emptyMessage={emptyMessage}
                onToggle={(id) => toggleEntity(option.clientKey, id)}
                disabledReason={offTrackReason}
                onRequireTrack={trackMissing ? onRequireTrack : undefined}
              />
            )}
            {hasTracks &&
              (fieldKey === "availability" ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "12px",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    Sets {trackName ?? "this track"} to
                  </span>
                  <TrackStatusMenu
                    status={statusFor(option)}
                    optional
                    onChange={(status) =>
                      onChange(
                        options.map((item) =>
                          item.clientKey === option.clientKey
                            ? {
                                ...item,
                                value: { shift_ids: shiftIdsFor(item), track_status: status },
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ) : (
                <TrackPicker
                  tracks={tracks}
                  option={option}
                  onChange={(next) =>
                    onChange(
                      options.map((item) => (item.clientKey === next.clientKey ? next : item)),
                    )
                  }
                />
              ))}
          </>
        )}
      />
      {fieldKey === "event_preference" && loaded.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => (trackMissing ? onRequireTrack?.() : setShowPicker(true))}
          style={{ alignSelf: "flex-start", marginTop: "6px" }}
        >
          <IconSearch size={12} /> Browse events
        </Button>
      )}
      {showPicker && (
        <EventOptionsPickerModal
          events={(loaded as TournamentEvent[]).filter((event) => !offTrackReason(event))}
          existingEventIds={existingEventIds}
          onClose={() => setShowPicker(false)}
          onConfirm={(newOptions) => {
            const [first, ...rest] = options;
            const firstIsEmptyPlaceholder =
              first && !first.label.trim() && shiftIdsFor(first).length === 0;
            onChange([...(firstIsEmptyPlaceholder ? rest : options), ...newOptions]);
          }}
        />
      )}
    </>
  );
}

function EntityPicker({
  selectedIds,
  entities,
  pickable,
  fieldKey,
  isMultiDay,
  emptyMessage,
  onToggle,
  disabledReason,
  onRequireTrack,
}: {
  selectedIds: number[];
  entities: Entity[];
  /** What the add list offers; `entities` is everything a chip may name. */
  pickable: Entity[];
  fieldKey: Exclude<EntityFieldKey, "track_status">;
  isMultiDay: boolean;
  emptyMessage: string;
  onToggle: (id: number) => void;
  /** Why an entity can't be picked, or undefined when it can. */
  disabledReason?: (entity: Entity) => string | undefined;
  /** Set while the question has no track: the add button sends the TD to the
      preset popover instead of opening a list it can't validate against. */
  onRequireTrack?: () => void;
}) {
  const selectedEntities = entities.filter((entity) => selectedIds.includes(entity.id));
  const entityForChip = (chip: string) =>
    selectedEntities.find((item) => entityLabel(fieldKey, item, isMultiDay) === chip);
  function handleChipsChange(chips: string[]) {
    const removed = selectedEntities.find(
      (entity) => !chips.includes(entityLabel(fieldKey, entity, isMultiDay)),
    );
    if (removed) onToggle(removed.id);
  }
  return (
    <ChipInput
      value={selectedEntities.map((entity) => entityLabel(fieldKey, entity, isMultiDay))}
      onChange={handleChipsChange}
      disableInput
      variant="transparent"
      size="sm"
      fullWidth
      getChipStatus={(chip) => {
        const entity = entityForChip(chip);
        return entity && disabledReason?.(entity) ? "error" : "default";
      }}
      getChipTooltip={(chip) => {
        const entity = entityForChip(chip);
        if (!entity) return undefined;
        return disabledReason?.(entity) ?? entityTooltip(fieldKey, entity, isMultiDay);
      }}
      addButton={
        onRequireTrack ? (
          <Button type="button" variant="secondary" size="xs" onClick={onRequireTrack}>
            <IconPlus size={11} /> {fieldKey === "availability" ? "Shifts" : "Events"}
          </Button>
        ) : (
          <ChecklistPopover
            trigger={
              <Button type="button" variant="secondary" size="xs">
                <IconPlus size={11} /> {fieldKey === "availability" ? "Shifts" : "Events"}
              </Button>
            }
            items={pickable}
            getKey={(entity) => entity.id}
            renderLabel={(entity) => entityPickerLabel(fieldKey, entity, isMultiDay)}
            onToggle={(entity) => onToggle(entity.id)}
            isSelected={(entity) => selectedIds.includes(entity.id)}
            isDisabled={(entity) => !!disabledReason?.(entity)}
            disabledReason={disabledReason}
            emptyMessage={emptyMessage}
            width={400}
          />
        )
      }
    />
  );
}

// track_status_* only — an availability field names one track in its key and
// gets a single status menu instead (see above).
function TrackPicker({
  tracks,
  option,
  onChange,
}: {
  tracks: TournamentTrack[];
  option: EditableOption;
  onChange: (option: EditableOption) => void;
}) {
  const assignments = assignmentsFor(option);
  const selected = tracks.filter((track) =>
    assignments.some((assignment) => assignment.id === track.id),
  );
  const byName = new Map(selected.map((track) => [track.name, track]));

  function replaceAssignments(nextAssignments: TrackStatusAssignment[]) {
    onChange({ ...option, value: nextAssignments });
  }
  function toggle(track: TournamentTrack) {
    replaceAssignments(
      assignments.some((item) => item.id === track.id)
        ? assignments.filter((item) => item.id !== track.id)
        : [...assignments, { id: track.id, status: "" as TrackStatus }],
    );
  }
  function setStatus(trackId: number, status: string) {
    replaceAssignments(
      assignments.map((item) =>
        item.id === trackId ? { ...item, status: status as TrackStatus } : item,
      ),
    );
  }

  return (
    <ChipInput
      value={selected.map((track) => track.name)}
      onChange={(names) => selected.filter((track) => !names.includes(track.name)).forEach(toggle)}
      disableInput
      variant="transparent"
      size="sm"
      fullWidth
      getChipStatus={(name) =>
        assignments.find((item) => item.id === byName.get(name)?.id)?.status ? "default" : "error"
      }
      renderChipTrailing={(name) => {
        const track = byName.get(name);
        const assignment = assignments.find((item) => item.id === track?.id);
        return track && assignment ? (
          <TrackStatusMenu
            status={assignment.status}
            onChange={(status) => setStatus(track.id, status)}
          />
        ) : null;
      }}
      addButton={
        <ChecklistPopover
          trigger={
            <Button type="button" variant="secondary" size="xs">
              <IconPlus size={11} /> Tracks
            </Button>
          }
          items={tracks.filter((track) => !track.is_archived)}
          getKey={(track) => track.id}
          renderLabel={(track) => track.name}
          onToggle={toggle}
          isSelected={(track) => assignments.some((item) => item.id === track.id)}
          emptyMessage="No active tracks."
          width={300}
        />
      }
    />
  );
}

// Colored per status so the chip reads at a glance, same palette as Badge's
// interested/confirmed/declined variants. An unset status stays muted — it's
// a slot to fill, not an outcome.
const STATUS_TONE: Record<TrackStatus | "", PillTone> = {
  "": "muted",
  interested: "default",
  confirmed: "success",
  declined: "danger",
};

// `optional` offers "No change" as a choice — an availability option may
// leave its track's status alone.
function TrackStatusMenu({
  status,
  onChange,
  optional = false,
}: {
  status: TrackStatus | "";
  onChange: (status: TrackStatus | "") => void;
  optional?: boolean;
}) {
  return (
    <PillMenu
      label={optional && !status ? "No change" : STATUS_LABEL[status]}
      tone={STATUS_TONE[status]}
      items={
        optional ? [...STATUS_OPTIONS, { value: "" as const, label: "No change" }] : STATUS_OPTIONS
      }
      getKey={(opt) => opt.value}
      renderLabel={(opt) => opt.label}
      onSelect={(opt) => onChange(opt.value)}
      width={140}
      align="left"
    />
  );
}
