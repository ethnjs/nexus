import { FormField, FormFieldOption } from "@/lib/api";

// A stored choice answer holds {option_id, value, label} snapshots (see
// snapshot_answer_value on the backend), but QuestionRenderer takes the same
// bare option_id shape a respondent submits. This unwraps one into the other —
// the frontend twin of the backend's selected_option_ids.

function unwrap(item: unknown): unknown {
  return item !== null && typeof item === "object" && "option_id" in item
    ? (item as { option_id: unknown }).option_id
    : item;
}

export function storedAnswerToInput(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(unwrap);
  // A ranked_choice answer is {rank: snapshot}; a single select is one snapshot.
  if (typeof value === "object" && !("option_id" in value)) {
    return Object.fromEntries(Object.entries(value).map(([rank, item]) => [rank, unwrap(item)]));
  }
  return unwrap(value);
}

function storedItems(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && !("option_id" in value)) return Object.values(value);
  return [value];
}

/** Options a stored answer picked that the field no longer offers — archived
 *  ones come from config, ones dropped from config entirely are rebuilt from
 *  the answer's own snapshot. Feed to QuestionRenderer's `removedOptions`. */
export function removedPickedOptions(field: FormField, value: unknown): FormFieldOption[] {
  const all = field.config?.options ?? [];
  const live = new Set(all.filter((o) => !o.is_archived).map((o) => o.option_id));
  const removed = new Map<string, FormFieldOption>();

  for (const item of storedItems(value)) {
    const optionId = unwrap(item);
    if (typeof optionId !== "string" || live.has(optionId) || removed.has(optionId)) continue;
    const fromConfig = all.find((o) => o.option_id === optionId);
    if (fromConfig) {
      removed.set(optionId, { ...fromConfig, is_archived: false });
    } else if (item !== null && typeof item === "object" && "label" in item) {
      const snap = item as { label: string; value?: FormFieldOption["value"] };
      removed.set(optionId, { option_id: optionId, label: snap.label, value: snap.value ?? optionId });
    }
    // A bare id with no snapshot (availability answers) has no label to show.
  }
  return [...removed.values()];
}

/** Nothing was given — blank text, no picks, no ranks. An unchecked
 *  acknowledgment (false) is still an answer. */
export function isBlankAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object" && !("option_id" in value)) return Object.keys(value).length === 0;
  return false;
}
