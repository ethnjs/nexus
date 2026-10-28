"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  EntityOptionsEditor,
  newEntityOption,
} from "@/components/forms/tournament/EntityOptionsEditor";
import { PresetPopover } from "@/components/forms/tournament/PresetPopover";
import {
  type FieldKeyUsage,
  type Form,
  type FormFieldOption,
  formsApi,
  type Tournament,
  type TournamentShift,
  type TournamentTrack,
  tournamentShiftsApi,
  tournamentsApi,
} from "@/lib/api";
import {
  type AddonOptionsEditorProps,
  type AddonToolbarProps,
  type ExtendableField,
  type FieldExtension,
  type FormBuilderAddon,
  NO_EXTENSION,
} from "@/lib/forms/builderAddon";
import {
  activePresetKind,
  allowsCustomValues,
  isEntityBackedPreset,
  isPresetError,
  PRESETS,
  parseAvailabilityFieldKey,
  parseEventPreferenceFieldKey,
  presetIssuesFor,
} from "@/lib/forms/tournament/presets";
import { formatTimeRange } from "@/lib/timeFormat";

// The tournament add-on: reserved-key presets (availability, event
// preference, lunch, track status) layered onto the core builder for
// tournament-owned forms. Everything it needs about the tournament is loaded
// by its Provider, since the builder route sits outside the dashboard's
// TournamentProvider.

interface TournamentBuilderData {
  /** null until loaded. */
  tournament: Tournament | null;
  /** The tournament's live tracks — what a preset binds to. */
  tracks: TournamentTrack[];
  /** Every shift, for previewing an availability option's times. null until loaded. */
  shifts: TournamentShift[] | null;
  /** Keys live on the tournament's other forms, with the forms using each. */
  sharedFieldKeys: FieldKeyUsage[];
  /** Refetches the tournament, so a tab left open a while doesn't bind presets to stale tracks. */
  reloadTournament: () => void;
}

const TournamentBuilderContext = createContext<TournamentBuilderData>({
  tournament: null,
  tracks: [],
  shifts: null,
  sharedFieldKeys: [],
  reloadTournament: () => {},
});

function TournamentBuilderProvider({ form, children }: { form: Form; children: ReactNode }) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [shifts, setShifts] = useState<TournamentShift[] | null>(null);
  const [sharedFieldKeys, setSharedFieldKeys] = useState<FieldKeyUsage[]>([]);
  const tournamentId = form.tournament_id;

  const reloadTournament = useCallback(() => {
    if (tournamentId == null) return;
    tournamentsApi
      .get(tournamentId)
      .then(setTournament)
      .catch(() => {});
  }, [tournamentId]);
  useEffect(reloadTournament, [reloadTournament]);

  useEffect(() => {
    if (tournamentId == null) return;
    tournamentShiftsApi
      .list(tournamentId)
      .then(setShifts)
      .catch(() => {});
  }, [tournamentId]);

  // Only the tournament's other forms: this form's own keys change as the TD
  // edits, and the builder checks those live against its questions.
  useEffect(() => {
    if (tournamentId == null) return;
    formsApi
      .listFieldKeysForTournament(tournamentId)
      .then((usages) =>
        setSharedFieldKeys(
          usages
            .map((usage) => ({ ...usage, forms: usage.forms.filter((f) => f.id !== form.id) }))
            .filter((usage) => usage.forms.length > 0),
        ),
      )
      .catch(() => {});
  }, [tournamentId, form.id]);

  const tracks = (tournament?.tracks ?? []).filter((track) => !track.is_archived);
  return (
    <TournamentBuilderContext.Provider
      value={{ tournament, tracks, shifts, sharedFieldKeys, reloadTournament }}
    >
      {children}
    </TournamentBuilderContext.Provider>
  );
}

function useTournamentBuilder(): TournamentBuilderData {
  return useContext(TournamentBuilderContext);
}

function PresetToolbar({
  field,
  onFieldChange,
  allFields,
  errors,
  saveAttempt,
  open,
  onOpenChange,
  demand,
}: AddonToolbarProps) {
  const { tracks, reloadTournament } = useTournamentBuilder();
  return (
    <PresetPopover
      field={field}
      onFieldChange={onFieldChange}
      tracks={tracks}
      onOpen={reloadTournament}
      errors={errors}
      saveAttempt={saveAttempt}
      demandComplete={demand}
      allFields={allFields}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

// Availability, event preference and track status options carry shift ids,
// event ids or track assignments rather than text, so they get the entity
// editor. Lunch options are ordinary text and keep the core one.
function PresetOptionsEditor({
  field,
  options,
  onChange,
  displayStyle,
  branchTargets,
  errors,
  allowArchive,
  onOpenAddon,
}: AddonOptionsEditorProps) {
  const { tournament } = useTournamentBuilder();
  const kind = activePresetKind(field.field_key);
  if (kind !== "availability" && kind !== "event_preference" && kind !== "track_status")
    return null;
  if (!tournament) {
    return (
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: "var(--color-text-tertiary)",
        }}
      >
        Loading…
      </p>
    );
  }
  // The track named in the field's own key — scopes what the entity pickers
  // may offer. track_status names no track, so it has none.
  const trackId =
    kind === "availability"
      ? parseAvailabilityFieldKey(field.field_key).trackId
      : kind === "event_preference"
        ? parseEventPreferenceFieldKey(field.field_key).trackId
        : null;
  return (
    <EntityOptionsEditor
      fieldKey={kind}
      trackId={trackId}
      tournament={tournament}
      questionType={field.question_type}
      options={options}
      onChange={onChange}
      displayStyle={displayStyle}
      branchTargets={branchTargets}
      errors={errors}
      trackStatusEnabled={kind === "track_status" || !!field.config?.track_status_enabled}
      allowArchive={allowArchive}
      onRequireTrack={onOpenAddon}
    />
  );
}

function extendField(field: ExtendableField): FieldExtension {
  const kind = activePresetKind(field.field_key);
  if (!kind) return NO_EXTENSION;
  return {
    keyLockedReason: `Set by the ${PRESETS[kind].label} preset — edit it from the presets icon below.`,
    allowedQuestionTypes: PRESETS[kind].allowedQuestionTypes,
    // A track status answer is what moves the member's track, so it can't be skipped.
    requiredLocked: kind === "track_status",
    allowsCustomValues: allowsCustomValues(kind),
    // Ranking one event twice means nothing, and the backend rejects the config.
    hideAllowDuplicates: kind === "event_preference",
    newOption: isEntityBackedPreset(kind) ? newEntityOption : undefined,
    keepsKeyOnDuplicate: true,
    OptionsEditor: kind === "lunch" ? undefined : PresetOptionsEditor,
  };
}

// The builder's options still hold raw shift ids, so the preview looks up
// their times here; respondents get them already resolved from the API.
function useOptionLabel(field: ExtendableField) {
  const { shifts } = useTournamentBuilder();
  if (activePresetKind(field.field_key) !== "availability" || !shifts) return undefined;
  return (option: FormFieldOption) => {
    const ids = shiftIdsOf(option.value);
    const matched = shifts.filter((shift) => ids.includes(shift.id));
    return matched.length > 0 ? `${option.label} (${formatTimeRange(matched)})` : option.label;
  };
}

function shiftIdsOf(value: FormFieldOption["value"]): number[] {
  const list = typeof value === "object" && !Array.isArray(value) ? value.shift_ids : value;
  return Array.isArray(list) ? list.filter((id): id is number => typeof id === "number") : [];
}

function useSharedFieldKeys(): FieldKeyUsage[] {
  return useTournamentBuilder().sharedFieldKeys;
}

export const tournamentAddon: FormBuilderAddon = {
  Provider: TournamentBuilderProvider,
  extendField,
  useOptionLabel,
  useSharedFieldKeys,
  Toolbar: PresetToolbar,
  issuesFor: presetIssuesFor,
  // An unfinished preset is fixed in the presets popover, so it's flagged there.
  ownsIssue: isPresetError,
};
