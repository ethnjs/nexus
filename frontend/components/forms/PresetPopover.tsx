"use client";

import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { FormPopover } from "@/components/ui/FormPopover";
import { Input } from "@/components/ui/Input";
import { IconPresets } from "@/components/ui/Icons";
import { EditableField } from "@/lib/forms/editableField";
import {
  PresetKind, PRESETS, activePresetKind, slugifyFieldKey,
  parseAvailabilityFieldKey, buildAvailabilityFieldKey,
  parseEventPreferenceFieldKey, buildEventPreferenceFieldKey,
  parseLunchFieldKey, buildLunchFieldKey,
} from "@/lib/forms/fieldKeyPresets";
import { sanitizeConfigForType } from "@/lib/forms/fieldTypes";

const KIND_OPTIONS: { value: PresetKind; label: string }[] = [
  { value: "availability", label: "Availability" },
  { value: "event_preference", label: "Event Pref." },
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
export function PresetPopover({ field, onFieldChange }: {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
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
    const sentinelKey = kind === "availability" ? "availability_" : kind === "event_preference" ? "event_preference_" : "lunch_";
    onFieldChange({
      field_key: sentinelKey,
      question_type: questionType,
      config: { ...sanitizeConfigForType(field.config, questionType), options: [] },
    });
  }

  return (
    <FormPopover
      trigger={<Button type="button" variant="secondary" size="sm" iconOnly title="Presets"><IconPresets size={14} /></Button>}
      width={260}
      align="left"
    >
      {() => (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <span style={{
              display: "block", marginBottom: "8px",
              fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
            }}>
              Reserved Preset
            </span>
            <ButtonGroup
              options={KIND_OPTIONS}
              value={presetKind ?? ""}
              onChange={(v) => applyPresetKind(v === presetKind ? null : (v as PresetKind))}
              size="sm"
              fullWidth
            />
          </div>
          {presetKind === "availability" && <AvailabilityParams field={field} onFieldChange={onFieldChange} />}
          {presetKind === "event_preference" && <EventPreferenceParams field={field} onFieldChange={onFieldChange} />}
          {presetKind === "lunch" && <LunchParams field={field} onFieldChange={onFieldChange} />}
        </div>
      )}
    </FormPopover>
  );
}

function AvailabilityParams({ field, onFieldChange }: { field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void }) {
  const { date } = parseAvailabilityFieldKey(field.field_key);
  return (
    <Input
      label="Date"
      type="date"
      value={date}
      onChange={(e) => onFieldChange({ field_key: buildAvailabilityFieldKey(e.target.value) })}
      size="sm"
      fullWidth
    />
  );
}

function EventPreferenceParams({ field, onFieldChange }: { field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void }) {
  const { suffix } = parseEventPreferenceFieldKey(field.field_key);
  return (
    <div>
      <Input
        label="Suffix"
        placeholder="e.g. morning"
        value={suffix}
        onChange={(e) => onFieldChange({ field_key: buildEventPreferenceFieldKey(e.target.value) })}
        size="sm"
        fullWidth
      />
      <p style={{ marginTop: "6px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
        {field.field_key === "event_preference_" ? "Set a suffix to derive the field key" : field.field_key}
      </p>
    </div>
  );
}

function LunchParams({ field, onFieldChange }: { field: EditableField; onFieldChange: (updates: Partial<EditableField>) => void }) {
  const { date, category } = parseLunchFieldKey(field.field_key);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <Input label="Date" type="date" value={date} onChange={(e) => onFieldChange({ field_key: buildLunchFieldKey(e.target.value, category) })} size="sm" fullWidth />
      <Input label="Category" placeholder="e.g. Protein" value={category} onChange={(e) => onFieldChange({ field_key: buildLunchFieldKey(date, e.target.value) })} size="sm" fullWidth />
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
        {field.field_key === "lunch_" ? "Set a date and category to derive the field key" : field.field_key}
      </p>
    </div>
  );
}
