"use client";

import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
import { IconPresets } from "@/components/ui/Icons";
import { EditableField } from "@/lib/forms/editableField";
import { formatDayLabel } from "@/lib/timeFormat";
import {
  PresetKind, PRESETS, activePresetKind, slugifyFieldKey,
  parseAvailabilityFieldKey, buildAvailabilityFieldKey,
  parseEventPreferenceFieldKey, buildEventPreferenceFieldKey,
  parseLunchFieldKey, buildLunchFieldKey,
} from "@/lib/forms/fieldKeyPresets";
import { sanitizeConfigForType } from "@/lib/forms/fieldTypes";

const KIND_OPTIONS: { value: PresetKind; label: string }[] = [
  { value: "availability", label: "Availability" },
  { value: "event_preference", label: "Event" },
  { value: "lunch", label: "Lunch" },
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
export function PresetPopover({ field, onFieldChange, tournamentDates }: {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
  /** The tournament's individual running days, ascending — availability/
      lunch pick from these rather than an unconstrained date input. Empty
      while still loading (or on a chapter-owned form with no tournament). */
  tournamentDates: string[];
}) {
  const presetKind = activePresetKind(field.field_key);

  function applyPresetKind(kind: PresetKind | null) {
    if (kind === null) {
      onFieldChange({
        field_key: slugifyFieldKey(field.label),
        config: { ...sanitizeConfigForType(field.config, field.question_type), options: [] },
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
      : "event_preference_";
    onFieldChange({
      field_key: fieldKey,
      question_type: questionType,
      config: { ...sanitizeConfigForType(field.config, questionType), options: [] },
    });
  }

  return (
    <FormPopover
      trigger={<Button type="button" variant="secondary" size="sm" iconOnly title="Presets"><IconPresets size={14} /></Button>}
      width={260}
      side="right"
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
            <ButtonGroup
              options={KIND_OPTIONS}
              value={presetKind ?? ""}
              onChange={(v) => applyPresetKind(v === presetKind ? null : (v as PresetKind))}
              size="sm"
              fullWidth
            />
          </div>
          {presetKind === "availability" && <AvailabilityParams field={field} onFieldChange={onFieldChange} tournamentDates={tournamentDates} />}
          {presetKind === "event_preference" && <EventPreferenceParams field={field} onFieldChange={onFieldChange} />}
          {presetKind === "lunch" && <LunchParams field={field} onFieldChange={onFieldChange} tournamentDates={tournamentDates} />}
          {presetKind && (
            <Input
              label="Field key"
              value={field.field_key}
              locked
              size="sm"
              fullWidth
            />
          )}
        </div>
      )}
    </FormPopover>
  );
}

function DayPicker({ label, date, tournamentDates, onChange }: {
  label: string;
  date: string;
  tournamentDates: string[];
  onChange: (date: string) => void;
}) {
  if (tournamentDates.length <= 1) {
    // Nothing to actually pick — either there's exactly one tournament day
    // (already auto-filled when the preset was chosen) or none loaded yet.
    return (
      <Input
        label={label}
        value={tournamentDates.length === 1 ? formatDayLabel(tournamentDates[0]) : "Loading tournament dates…"}
        locked
        size="sm"
        fullWidth
      />
    );
  }
  return (
    <Dropdown
      label={label}
      value={date}
      onChange={onChange}
      options={tournamentDates.map((d) => ({ value: d, label: formatDayLabel(d) }))}
      placeholder="Select a date"
      size="sm"
      fullWidth
    />
  );
}

function AvailabilityParams({ field, onFieldChange, tournamentDates }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; tournamentDates: string[];
}) {
  const { date } = parseAvailabilityFieldKey(field.field_key);
  return (
    <DayPicker
      label="Date"
      date={date}
      tournamentDates={tournamentDates}
      onChange={(newDate) => onFieldChange({ field_key: buildAvailabilityFieldKey(newDate) })}
    />
  );
}

function EventPreferenceParams({ field, onFieldChange }: { field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void }) {
  const { suffix } = parseEventPreferenceFieldKey(field.field_key);
  return (
    <Input
      label="Suffix"
      placeholder="e.g. morning"
      value={suffix}
      onChange={(e) => onFieldChange({ field_key: buildEventPreferenceFieldKey(e.target.value) })}
      size="sm"
      fullWidth
    />
  );
}

function LunchParams({ field, onFieldChange, tournamentDates }: {
  field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void; tournamentDates: string[];
}) {
  const { date, category } = parseLunchFieldKey(field.field_key);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <DayPicker
        label="Date"
        date={date}
        tournamentDates={tournamentDates}
        onChange={(newDate) => onFieldChange({ field_key: buildLunchFieldKey(newDate, category) })}
      />
      <Input
        label="Category"
        placeholder="e.g. Protein"
        value={category}
        onChange={(e) => onFieldChange({ field_key: buildLunchFieldKey(date, e.target.value) })}
        size="sm"
        fullWidth
      />
    </div>
  );
}
