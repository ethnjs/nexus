"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { IconPresets } from "@/components/ui/Icons";
import { TournamentDayPicker } from "@/components/tournament/TournamentDayPicker";
import { newEntityOption, newOption } from "@/components/forms/OptionsEditor";
import { EditableField } from "@/lib/forms/editableField";
import {
  PresetKind, PRESETS, activePresetKind, isEntityBackedPreset, slugifyFieldKey, isPresetError,
  parseAvailabilityFieldKey, buildAvailabilityFieldKey,
  parseEventPreferenceFieldKey, buildEventPreferenceFieldKey,
  parseLunchFieldKey, buildLunchFieldKey,
  parseTrackStatusFieldKey, buildTrackStatusFieldKey,
} from "@/lib/forms/fieldKeyPresets";
import { OPTION_BEARING_TYPES, sanitizeConfigForType } from "@/lib/forms/fieldTypes";

const KIND_OPTIONS: { value: PresetKind | ""; label: string }[] = [
  { value: "", label: "No preset" },
  { value: "availability", label: "Availability" },
  { value: "event_preference", label: "Event" },
  { value: "lunch", label: "Lunch" },
  { value: "track_status", label: "Track Status" },
];

// Reserved-key presets (availability_{date}, event_preference_{suffix},
// lunch_{date}_{category}) — split into their own toolbar popover from
// FieldKeyPopover's plain free-text key, since a preset now needs its own
// parameter input(s) (a date, a suffix, a date+category pair) rather than
// being a single fixed field_key a TD picks off a list. Choosing/changing a
// preset here always resets `options` — an entity-backed picker's
// `value: number[]` and a freeform row's `value: string` aren't
// interchangeable, so switching kinds (including back to "no preset")
// can't safely keep whatever was there before.
export function PresetPopover({
  field, onFieldChange, tournamentDates, onOpen, errors, saveAttempt, open, onOpenChange,
}: {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
  /** The tournament's individual running days, ascending — availability/
      lunch pick from these rather than an unconstrained date input. Empty
      while still loading (or on a chapter-owned form with no tournament). */
  tournamentDates: string[];
  /** Fires when the panel opens — FieldList uses this to refetch the
      tournament's date range right then, rather than relying on a snapshot
      fetched once whenever the page first loaded (which could be stale by
      the time this actually gets opened, in a tab left open a while). */
  onOpen?: () => void;
  errors: string[];
  /** Bumped by FieldList each time a Save attempt fails validation — see
      FieldKeyPopover's identical prop for why this (not just `errors`) is
      what drives auto-opening. */
  saveAttempt: number;
  /** Owned by FieldToolbar (shared with FieldKeyPopover) — only one of the
      two can be open at a time, so this can't be local state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const presetKind = activePresetKind(field.field_key);
  const presetError = errors.find(isPresetError);

  useEffect(() => {
    if (saveAttempt > 0 && presetError) onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAttempt]);

  function applyPresetKind(kind: PresetKind | null) {
    if (kind === null) {
      const options = OPTION_BEARING_TYPES.includes(field.question_type) ? [newOption()] : [];
      onFieldChange({
        field_key: slugifyFieldKey(field.label),
        config: { ...sanitizeConfigForType(field.config, field.question_type), options },
      });
      return;
    }
    const meta = PRESETS[kind];
    const questionType = meta.allowedQuestionTypes.includes(field.question_type) ? field.question_type : meta.defaultQuestionType;
    // A tournament with exactly one running day has nothing to actually
    // choose for a date-based preset, so it's filled in immediately rather
    // than leaving a "pick the one option you have" control behind.
    const soleDay = tournamentDates.length === 1 ? tournamentDates[0] : undefined;
    const fieldKey =
      kind === "availability" ? buildAvailabilityFieldKey(soleDay ?? "")
      : kind === "lunch" ? buildLunchFieldKey(soleDay ?? "", "")
      : kind === "track_status" ? "track_status_"
      : "event_preference_";
    // Every preset's allowedQuestionTypes is option-bearing, so there's
    // always exactly one starter row to seed here — entity-shaped (an empty
    // id array to fill in via the picker) for availability/event_preference,
    // plain freeform for lunch — rather than leaving the TD looking at an
    // empty list with nothing to click but "Add option."
    const starterOption = isEntityBackedPreset(kind) ? newEntityOption() : newOption();
    onFieldChange({
      field_key: fieldKey,
      question_type: questionType,
      config: { ...sanitizeConfigForType(field.config, questionType), required: kind === "track_status" ? true : field.config?.required ?? false, options: [starterOption] },
    });
  }

  return (
    <FormPopover
      trigger={
        <Button
          type="button" variant={presetError ? "danger" : open ? "primary" : "secondary"} size="sm" iconOnly title="Presets"
        >
          <IconPresets size={14} />
        </Button>
      }
      width={250}
      side="right"
      open={open}
      onOpenChange={(next) => { onOpenChange(next); if (next) onOpen?.(); }}
      closeOnOutsideClick={false}
    >
      {() => (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <span style={{
              display: "block", marginBottom: "8px",
              fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
            }}>
              Preset
            </span>
            <Dropdown
              options={KIND_OPTIONS}
              value={presetKind ?? ""}
              onChange={(value) => applyPresetKind(value ? value as PresetKind : null)}
              size="sm"
              fullWidth
            />
          </div>
          {presetKind === "availability" && (
            <>
              <AvailabilityParams field={field} onFieldChange={onFieldChange} tournamentDates={tournamentDates} showErrors={!!presetError} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>Also update track status</span>
                <Toggle
                  checked={!!field.config?.track_status_enabled}
                  onChange={(checked) => onFieldChange({
                    config: {
                      ...field.config,
                      track_status_enabled: checked,
                      options: field.config?.options?.map((option) => {
                        if (checked && Array.isArray(option.value)) {
                          return { ...option, value: { shift_ids: option.value, track_statuses: [] } };
                        }
                        if (!checked && typeof option.value === "object" && !Array.isArray(option.value)) {
                          return { ...option, value: option.value.shift_ids ?? [] };
                        }
                        return option;
                      }),
                    },
                  })}
                />
              </div>
            </>
          )}
          {presetKind === "event_preference" && (
            <EventPreferenceParams field={field} onFieldChange={onFieldChange} showErrors={!!presetError} />
          )}
          {presetKind === "lunch" && (
            <LunchParams field={field} onFieldChange={onFieldChange} tournamentDates={tournamentDates} showErrors={!!presetError} />
          )}
          {presetKind === "track_status" && (
            <TrackStatusParams field={field} onFieldChange={onFieldChange} showErrors={!!presetError} />
          )}
        </div>
      )}
    </FormPopover>
  );
}

function TrackStatusParams({ field, onFieldChange, showErrors }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; showErrors: boolean;
}) {
  const { suffix: parsedSuffix } = parseTrackStatusFieldKey(field.field_key);
  const [suffix, setSuffix] = useState(parsedSuffix);
  function handleChange(value: string) {
    setSuffix(value);
    onFieldChange({ field_key: buildTrackStatusFieldKey(value) });
  }
  return <Input label="Suffix" placeholder="e.g. volunteer interest" value={suffix} onChange={(e) => handleChange(e.target.value)} size="sm" fullWidth error={showErrors && !parsedSuffix ? "Suffix is required." : undefined} />;
}

function DayPicker({ label, date, tournamentDates, onChange, error }: {
  label: string;
  date: string;
  tournamentDates: string[];
  onChange: (date: string) => void;
  error?: string;
}) {
  // A sole tournament day is auto-applied the instant the preset is picked
  // (see applyPresetKind), but that can race the tournamentDates fetch — if
  // it resolves *after* the preset was already chosen, retroactively fill
  // it in here too rather than leaving the field stuck on the sentinel with
  // a picker that has nothing left to pick. Only PresetPopover has this
  // race (tournamentDates is fetched separately from the rest of the forms
  // builder), so it stays local here rather than in TournamentDayPicker
  // itself — there's also never really a missing-date error to show while
  // it's unresolved.
  useEffect(() => {
    if (!date && tournamentDates.length === 1) onChange(tournamentDates[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentDates]);

  return (
    <TournamentDayPicker
      label={label}
      value={date}
      onChange={onChange}
      days={tournamentDates}
      placeholder="Select a date"
      size="sm"
      fullWidth
      error={error}
    />
  );
}

function AvailabilityParams({ field, onFieldChange, tournamentDates, showErrors }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; tournamentDates: string[]; showErrors: boolean;
}) {
  const { date } = parseAvailabilityFieldKey(field.field_key);
  return (
    <DayPicker
      label="Date"
      date={date}
      tournamentDates={tournamentDates}
      onChange={(newDate) => onFieldChange({ field_key: buildAvailabilityFieldKey(newDate) })}
      error={showErrors && !date ? "Date is required." : undefined}
    />
  );
}

// Local suffix state, synced FROM field_key but not read straight back out
// of it on every keystroke — same reasoning as LunchParams below:
// buildEventPreferenceFieldKey slugifies (and trims trailing separators),
// so a display value derived straight from field_key would eat the
// trailing space after each word, making a multi-word suffix like
// "morning session" impossible to type.
function EventPreferenceParams({ field, onFieldChange, showErrors }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; showErrors: boolean;
}) {
  const { suffix: parsedSuffix } = parseEventPreferenceFieldKey(field.field_key);
  const [suffix, setSuffix] = useState(parsedSuffix);

  function handleChange(newSuffix: string) {
    setSuffix(newSuffix);
    onFieldChange({ field_key: buildEventPreferenceFieldKey(newSuffix) });
  }

  return (
    <Input
      label="Suffix"
      placeholder="e.g. morning session"
      value={suffix}
      onChange={(e) => handleChange(e.target.value)}
      size="sm"
      fullWidth
      error={showErrors && !parsedSuffix ? "Suffix is required." : undefined}
    />
  );
}

// Local date/category state, synced FROM field_key but not read straight
// back out of it on every keystroke — buildLunchFieldKey collapses to the
// bare "lunch_" sentinel whenever *either* half is still missing (there's no
// valid "lunch_{date}_" partial shape), so deriving the category input's
// value straight from field_key would make it snap back to empty on every
// character typed until a date happens to already be set too. Local state
// lets each half hold what was actually typed regardless of whether the
// other one is filled in yet.
function LunchParams({ field, onFieldChange, tournamentDates, showErrors }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; tournamentDates: string[]; showErrors: boolean;
}) {
  const parsed = parseLunchFieldKey(field.field_key);
  const [date, setDateState] = useState(parsed.date);
  const [category, setCategoryState] = useState(parsed.category);

  function setDate(newDate: string) {
    setDateState(newDate);
    onFieldChange({ field_key: buildLunchFieldKey(newDate, category) });
  }

  function setCategory(newCategory: string) {
    setCategoryState(newCategory);
    onFieldChange({ field_key: buildLunchFieldKey(date, newCategory) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <DayPicker
        label="Date"
        date={date}
        tournamentDates={tournamentDates}
        onChange={setDate}
        error={showErrors && !date ? "Date is required." : undefined}
      />
      <Input
        label="Category"
        placeholder="e.g. Protein"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        size="sm"
        fullWidth
        error={showErrors && !category ? "Category is required." : undefined}
      />
    </div>
  );
}
