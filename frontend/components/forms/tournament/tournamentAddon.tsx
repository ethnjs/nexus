"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { newEntityOption } from "@/components/forms/OptionsEditor";
import { PresetPopover } from "@/components/forms/PresetPopover";
import { type Form, type Tournament, type TournamentTrack, tournamentsApi } from "@/lib/api";
import {
  type AddonToolbarProps,
  CORE_ONLY,
  type ExtendableField,
  type FieldExtension,
  type FormBuilderAddon,
  NO_EXTENSION,
} from "@/lib/forms/builderAddon";
import {
  activePresetKind,
  allowsCustomValues,
  isEntityBackedPreset,
  PRESETS,
} from "@/lib/forms/tournament/presets";

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
  /** Refetches the tournament, so a tab left open a while doesn't bind presets to stale tracks. */
  reloadTournament: () => void;
}

const TournamentBuilderContext = createContext<TournamentBuilderData>({
  tournament: null,
  tracks: [],
  reloadTournament: () => {},
});

function TournamentBuilderProvider({ form, children }: { form: Form; children: ReactNode }) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const tournamentId = form.tournament_id;

  const reloadTournament = useCallback(() => {
    if (tournamentId == null) return;
    tournamentsApi
      .get(tournamentId)
      .then(setTournament)
      .catch(() => {});
  }, [tournamentId]);
  useEffect(reloadTournament, [reloadTournament]);

  const tracks = (tournament?.tracks ?? []).filter((track) => !track.is_archived);
  return (
    <TournamentBuilderContext.Provider value={{ tournament, tracks, reloadTournament }}>
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

function extendField(field: ExtendableField): FieldExtension {
  const kind = activePresetKind(field.field_key);
  if (!kind) return NO_EXTENSION;
  return {
    keyLockedReason: `Set by the ${PRESETS[kind].label} preset — edit it from the presets icon below.`,
    allowedQuestionTypes: PRESETS[kind].allowedQuestionTypes,
    // A track status answer is what moves the member's track, so it can't be skipped.
    requiredLocked: kind === "track_status",
    allowsCustomValues: allowsCustomValues(kind),
    newOption: isEntityBackedPreset(kind) ? newEntityOption : undefined,
    keepsKeyOnDuplicate: true,
  };
}

export const tournamentAddon: FormBuilderAddon = {
  ...CORE_ONLY,
  Provider: TournamentBuilderProvider,
  extendField,
  Toolbar: PresetToolbar,
};
