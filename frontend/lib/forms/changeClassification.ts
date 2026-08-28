import { FormField, FormFieldConfig, FormQuestionType, PendingUpdateReason } from "@/lib/api";
import { EditableField } from "@/lib/forms/editableField";
import { activePresetKind } from "@/lib/forms/fieldKeyPresets";

// Mirrors backend/app/core/form/changes.py. The server decides what actually
// gets flagged — this exists so the TD can *see* it before saving, and so the
// confirmation modal knows which toggles to lock. Any rule added there has to
// be added here too, or the modal will quietly under-report.

// Answer storage shape per question_type. A type change only matters when it
// moves between classes — radio -> dropdown leaves every stored answer valid.
const SHAPE_CLASSES: Record<string, string> = {
  short_text: "text",
  long_text: "text",
  single_select_radio: "single_select",
  single_select_dropdown: "single_select",
  multi_select_checkbox: "multi",
  ranked_choice: "ranked",
  acknowledgment: "bool",
};

export const MANDATORY_REASONS: PendingUpdateReason[] = [
  "question_type_changed", "option_added", "option_invalidated", "option_regrouped", "now_required",
];

/** Default for each judgment call when the TD doesn't touch the toggle. */
export const OPTIONAL_REASON_DEFAULTS: Partial<Record<PendingUpdateReason, boolean>> = {
  key_changed: true,
  text_changed: false,
};

export const REASON_LABELS: Record<PendingUpdateReason, string> = {
  question_type_changed: "The answer format changed",
  option_added: "An option was added",
  option_invalidated: "An option was removed",
  option_regrouped: "An option covers different shifts or events",
  now_required: "This question is now required",
  key_changed: "Switched between a preset and a standard question",
  text_changed: "The wording changed",
};

/** What the TD is actually deciding, for the judgment calls only. */
export const REASON_CONSEQUENCES: Partial<Record<PendingUpdateReason, string>> = {
  key_changed:
    "Their answers won't reach availability, lunch or track status unless they resubmit.",
  text_changed:
    "Only ask again if the new wording changes what you're asking for.",
};

export function isMandatory(reason: PendingUpdateReason): boolean {
  return MANDATORY_REASONS.includes(reason);
}

function optionIds(config: FormFieldConfig | null | undefined, liveOnly: boolean): Set<string> {
  const options = config?.options ?? [];
  return new Set(
    options
      .filter((o) => !(liveOnly && o.is_archived))
      .map((o) => o.option_id)
      .filter(Boolean) as string[]
  );
}

function labelsById(config: FormFieldConfig | null | undefined): Map<string, string> {
  return new Map((config?.options ?? []).map((o) => [o.option_id as string, o.label]));
}

/** Entity ids per option, for presets where `value` is shifts/events rather
    than display text. */
function entityIdsById(config: FormFieldConfig | null | undefined): Map<string, string> {
  const grouped = new Map<string, string>();
  for (const option of config?.options ?? []) {
    const value = option.value;
    if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
      grouped.set(option.option_id as string, [...(value as number[])].sort((a, b) => a - b).join(","));
    }
  }
  return grouped;
}

export function classifyFieldChange(before: FormField, after: EditableField): PendingUpdateReason[] {
  const reasons: PendingUpdateReason[] = [];
  const oldConfig = before.config;
  const newConfig = after.config;

  const shapeChanged =
    SHAPE_CLASSES[after.question_type as FormQuestionType] !== SHAPE_CLASSES[before.question_type];
  if (shapeChanged) reasons.push("question_type_changed");

  // Options only compare within a shape class — across classes the whole
  // answer is invalid anyway, and reporting an option change alongside would
  // describe a consequence of the type change rather than a separate thing.
  if (!shapeChanged) {
    const oldLive = optionIds(oldConfig, true);
    const oldAll = optionIds(oldConfig, false);
    const newLive = optionIds(newConfig, true);
    const newAll = optionIds(newConfig, false);

    if ([...newLive].some((id) => !oldLive.has(id))) reasons.push("option_added");
    if ([...oldAll].some((id) => !newAll.has(id))) reasons.push("option_invalidated");

    if (activePresetKind(after.field_key)) {
      const oldGroups = entityIdsById(oldConfig);
      const newGroups = entityIdsById(newConfig);
      const regrouped = [...newGroups].some(([id, group]) => oldGroups.has(id) && oldGroups.get(id) !== group);
      if (regrouped) reasons.push("option_regrouped");
    }
  }

  if (newConfig?.required && !oldConfig?.required) reasons.push("now_required");

  const wasPreset = !!activePresetKind(before.field_key);
  const isPreset = !!activePresetKind(after.field_key);
  if (wasPreset !== isPreset) reasons.push("key_changed");

  const oldLabels = labelsById(oldConfig);
  const optionLabelChanged = [...labelsById(newConfig)].some(
    ([id, label]) => oldLabels.has(id) && oldLabels.get(id) !== label
  );
  const description = after.showDescription ? after.description : null;
  if (after.label.trim() !== before.label || description !== before.description || optionLabelChanged) {
    reasons.push("text_changed");
  }

  return reasons;
}

export interface ClassifiedChange {
  clientKey: string;
  label: string;
  reasons: PendingUpdateReason[];
  /** True when at least one reason is mandatory — the toggle is locked on. */
  locked: boolean;
}

/** Every staged edit that could ask someone to answer again. Fields with no
    such change aren't included: the modal is a list of consequences, not a
    diff of the save. */
export function classifyEdits(before: FormField[], after: EditableField[]): ClassifiedChange[] {
  const byId = new Map(before.map((f) => [f.id, f]));
  const changes: ClassifiedChange[] = [];
  for (const field of after) {
    const original = field.id ? byId.get(field.id) : undefined;
    // A newly added field has nobody to notify, and an unarchived one comes
    // back exactly as it was left.
    if (!original || original.is_archived) continue;
    const reasons = classifyFieldChange(original, field);
    if (reasons.length === 0) continue;
    changes.push({
      clientKey: field.clientKey,
      label: field.label.trim() || "Untitled question",
      reasons,
      locked: reasons.some(isMandatory),
    });
  }
  return changes;
}

/** The default toggle state for a change: on if anything mandatory applies,
    otherwise whichever of its judgment calls defaults on. */
export function defaultNotify(change: ClassifiedChange): boolean {
  if (change.locked) return true;
  return change.reasons.some((r) => OPTIONAL_REASON_DEFAULTS[r]);
}
