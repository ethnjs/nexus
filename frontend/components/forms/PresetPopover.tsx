"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { IconPresets, IconX } from "@/components/ui/Icons";
import { TournamentDayPicker } from "@/components/tournament/TournamentDayPicker";
import { newEntityOption, newOption } from "@/components/forms/OptionsEditor";
import { FormQuestionType } from "@/lib/api";
import { EditableField } from "@/lib/forms/editableField";
import {
  PresetKind, PRESETS, activePresetKind, isEntityBackedPreset, slugifyFieldKey, isPresetError, isFieldKeyError,
  parseAvailabilityFieldKey, buildAvailabilityFieldKey,
  parseEventPreferenceFieldKey, buildEventPreferenceFieldKey,
  parseLunchFieldKey, buildLunchFieldKey,
  parseTrackStatusFieldKey, buildTrackStatusFieldKey,
} from "@/lib/forms/fieldKeyPresets";
import { OPTION_BEARING_TYPES, sanitizeConfigForType } from "@/lib/forms/fieldTypes";

type EditableOption = NonNullable<NonNullable<EditableField["config"]>["options"]>[number];

function isAssignmentList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "id" in item && "status" in item);
}

// The option rows a field keeps when its preset changes — including changing
// to "no preset". Rows, labels and branch targets are the TD's work and
// always survive; only each `value` is rewritten, since the three shapes
// (freeform string, entity ids, track assignments) aren't interchangeable. A
// value that can't carry into the new shape falls back to the row's own
// label (freeform) or an empty selection (entity/track), never to a dropped
// row. Returns a single starter row only when there was nothing to keep.
function carryOptions(field: EditableField, kind: PresetKind | null, questionType: FormQuestionType): EditableOption[] {
  if (!OPTION_BEARING_TYPES.includes(questionType)) return [];
  const supportsBranching = questionType === "single_select_radio" || questionType === "single_select_dropdown";
  const existing = field.config?.options ?? [];
  if (existing.length === 0) return [isEntityBackedPreset(kind) ? newEntityOption() : newOption()];
  return existing.map((option) => ({
    ...option,
    ...(supportsBranching ? {} : { next_field_id: null, action: null }),
    value: isEntityBackedPreset(kind)
      ? (Array.isArray(option.value) && option.value.every((value) => typeof value === "number") ? option.value : [])
      : kind === "track_status"
        ? (isAssignmentList(option.value) ? option.value : [])
        : typeof option.value === "string" ? option.value : option.label,
  }));
}

const KIND_OPTIONS: { value: PresetKind; label: string }[] = [
  { value: "availability", label: "Availability" },
  { value: "event_preference", label: "Event" },
  { value: "lunch", label: "Lunch" },
  { value: "track_status", label: "Track" },
];

// Reserved-key presets (availability_{date}, event_preference_{suffix},
// lunch_{date}_{category}) — split into their own toolbar popover from
// FieldKeyPopover's plain free-text key, since a preset now needs its own
// parameter input(s) (a date, a suffix, a date+category pair) rather than
// being a single fixed field_key a TD picks off a list. Choosing/changing a
// preset here keeps the TD's option rows and their branch targets — only each
// value's *shape* is rewritten to fit the new kind (see reshapeOptions).
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
  const incompleteError = errors.find(isPresetError);
  // A field_key collision with another form's field is only ever caught at
  // Save (FieldKeyPopover's own client-side blur check can't see across
  // forms) — see useFormValidation's handle422. Once this field is
  // preset-keyed, that's a preset-parameter problem, not a plain-key one, so
  // it's this popover's to show rather than FieldKeyPopover's (which locks
  // its input the moment a preset is active).
  const rawDuplicateError = presetKind ? errors.find(isFieldKeyError) : undefined;
  // Unlike incompleteError (whose displayed text is re-derived live per input
  // — see AvailabilityParams etc.), the collision message itself is a static
  // snapshot from the last failed Save, naming whatever key was rejected
  // then. Once the TD changes any preset parameter that key is stale, so it's
  // dismissed the same way FieldKeyPopover clears its own localError: on the
  // next field_key change, not on the next validate() pass.
  const [dupDismissed, setDupDismissed] = useState(false);
  const prevFieldKeyRef = useRef(field.field_key);
  useEffect(() => {
    if (field.field_key !== prevFieldKeyRef.current) {
      prevFieldKeyRef.current = field.field_key;
      setDupDismissed(true);
    }
  }, [field.field_key]);
  const duplicateError = dupDismissed ? undefined : rawDuplicateError;
  const keyError = incompleteError ?? duplicateError;

  useEffect(() => {
    if (saveAttempt > 0 && (incompleteError || rawDuplicateError)) { onOpenChange(true); setDupDismissed(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveAttempt]);

  function applyPresetKind(kind: PresetKind | null) {
    if (kind === null) {
      // Clearing is just another kind change: keep the rows, drop back to
      // freeform values, and only seed a starter row if there was nothing
      // to keep. track_status_enabled goes with the preset — it's an
      // availability-only opt-in, and the backend rejects the flag on any
      // other key.
      const options = carryOptions(field, null, field.question_type);
      onFieldChange({
        field_key: slugifyFieldKey(field.label),
        config: {
          ...sanitizeConfigForType(field.config, field.question_type),
          track_status_enabled: undefined,
          // Only when the type actually takes options: the text config
          // schemas are extra="forbid", so even an empty array 422s the save.
          ...(OPTION_BEARING_TYPES.includes(field.question_type) ? { options } : {}),
        },
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
    // Seeds one starter row for the option-bearing types — entity-shaped (an
    // empty id array to fill in via the picker) for availability/
    // event_preference, plain freeform for lunch — rather than leaving the TD
    // looking at an empty list with nothing to click but "Add option."
    // Lunch also allows short_text/long_text, which take no options at all;
    // carryOptions returns [] for those, and it must not reach the config
    // since TextConfig is extra="forbid" and rejects even an empty array.
    const options = carryOptions(field, kind, questionType);
    onFieldChange({
      field_key: fieldKey,
      question_type: questionType,
      config: {
        ...sanitizeConfigForType(field.config, questionType),
        required: kind === "track_status" ? true : field.config?.required ?? false,
        // Only availability opts into track statuses via this flag; every
        // other kind (track_status included — its key alone enables them)
        // must not carry it over.
        track_status_enabled: kind === "availability" ? field.config?.track_status_enabled : undefined,
        ...(OPTION_BEARING_TYPES.includes(questionType) ? { options } : {}),
      },
    });
  }

  return (
    <FormPopover
      trigger={
        <Button
          type="button" variant={keyError ? "danger" : open ? "primary" : "secondary"} size="sm" iconOnly title="Presets"
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
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Dropdown
                options={KIND_OPTIONS}
                value={presetKind ?? ""}
                onChange={(value) => applyPresetKind(value as PresetKind)}
                placeholder="No preset"
                size="sm"
                fullWidth
              />
              {presetKind && (
                <Button
                  type="button" variant="ghost" size="sm" iconOnly
                  title="Clear preset"
                  onClick={() => applyPresetKind(null)}
                  style={{ width: "28px", height: "28px", padding: 0, flexShrink: 0 }}
                >
                  <IconX size={14} />
                </Button>
              )}
            </div>
          </div>
          {duplicateError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
              {duplicateError}
            </p>
          )}
          {presetKind === "availability" && (
            <>
              <AvailabilityParams field={field} onFieldChange={onFieldChange} tournamentDates={tournamentDates} showErrors={!!incompleteError} />
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
                          const shiftIds = option.value.every((value) => typeof value === "number")
                            ? option.value as number[]
                            : [];
                          return { ...option, value: { shift_ids: shiftIds, track_statuses: [] } };
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
            <EventPreferenceParams field={field} onFieldChange={onFieldChange} showErrors={!!incompleteError} />
          )}
          {presetKind === "lunch" && (
            <LunchParams field={field} onFieldChange={onFieldChange} tournamentDates={tournamentDates} showErrors={!!incompleteError} />
          )}
          {presetKind === "track_status" && (
            <TrackStatusParams field={field} onFieldChange={onFieldChange} showErrors={!!incompleteError} />
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

// Local suffix state, synced FROM field_key but not read straight back out
// of it on every keystroke — same reasoning as LunchParams' category below.
// Unlike lunch's category, the suffix here is optional: it only exists to
// disambiguate two fields sharing a date across different forms, so leaving
// it blank is a valid, complete field_key on its own.
function AvailabilityParams({ field, onFieldChange, tournamentDates, showErrors }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; tournamentDates: string[]; showErrors: boolean;
}) {
  const parsed = parseAvailabilityFieldKey(field.field_key);
  const [suffix, setSuffixState] = useState(parsed.suffix);

  function setDate(newDate: string) {
    onFieldChange({ field_key: buildAvailabilityFieldKey(newDate, suffix) });
  }

  function setSuffix(newSuffix: string) {
    setSuffixState(newSuffix);
    onFieldChange({ field_key: buildAvailabilityFieldKey(parsed.date, newSuffix) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <DayPicker
        label="Date"
        date={parsed.date}
        tournamentDates={tournamentDates}
        onChange={setDate}
        error={showErrors && !parsed.date ? "Date is required." : undefined}
      />
      <Input
        label="Suffix (optional)"
        placeholder="e.g. confirmation"
        value={suffix}
        onChange={(e) => setSuffix(e.target.value)}
        size="sm"
        fullWidth
      />
    </div>
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
