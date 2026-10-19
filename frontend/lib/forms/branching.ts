import type { FormField, FormFieldConfig, FormFieldOption } from "@/lib/api";
import { BRANCHING_TYPES } from "@/lib/forms/fieldTypes";
import { toPlainText } from "@/lib/markdown";

// Branching: a single-select option may jump forward to a later question or
// submit the form. Forward-only is what keeps the respondent's walk loop-free
// (the backend enforces it too — see validate_branching_options).

interface BranchableField {
  clientKey: string;
  id: string | null;
  label: string;
  config: FormFieldConfig | null;
}

// Another field on the form, placed relative to the one being edited. id is
// null until the field is saved, so unsaved fields show up disabled with a
// reason rather than being silently excluded. Only fields `below` are offered
// as jumps: `next` is what Continue already does, and an `above` field is
// shown only when a reorder left an option pointing at it.
export interface BranchTarget {
  id: string | null;
  label: string;
  position: "above" | "next" | "below";
}

export function branchTargetsFor(
  field: BranchableField,
  fields: BranchableField[],
): BranchTarget[] {
  const position = fields.findIndex((f) => f.clientKey === field.clientKey);
  return fields.flatMap<BranchTarget>((f, i) =>
    i === position
      ? []
      : [
          {
            id: f.id,
            label: toPlainText(f.label).trim(),
            position: i < position ? "above" : i === position + 1 ? "next" : "below",
          },
        ],
  );
}

// Jump targets that sit at or above `field` in `fields`. Branches only go
// forward, so a reorder can leave one of these behind.
export function backwardBranchTargetIds(
  field: BranchableField,
  fields: BranchableField[],
): Set<string> {
  const position = fields.findIndex((f) => f.clientKey === field.clientKey);
  const upToHere = new Set(fields.slice(0, position + 1).map((f) => f.id));
  return new Set(
    (field.config?.options ?? [])
      .filter((o) => !o.is_archived)
      .map((o) => o.next_field_id)
      .filter((id): id is string => id != null && upToHere.has(id)),
  );
}

// Seeds the builder's branching toggle from a loaded field, so it reflects
// real data instead of hiding a branch an earlier session set up.
export function deriveBranchingEnabled(field: FormField): boolean {
  return (field.config?.options ?? []).some((o) => o.next_field_id != null || o.action != null);
}

// Turning branching off resets every option to "continue", so turning it back
// on later starts clean instead of reviving jump targets from before.
export function withoutBranching<T extends FormFieldOption>(options: T[]): T[] {
  return options.map((o) => ({ ...o, next_field_id: null, action: null }));
}

// Mirrors backend/app/core/form/branching.py's compute_reachable_field_ids —
// same walk (lowest-order field first, following each branching option's
// next_field_id/action, falling through to the next field by order
// otherwise, ending at a revisited field rather than looping forever) so
// every viewer's question sequence always matches what a real respondent
// would see and what the server would accept.
export function computeWalk(fields: FormField[], answers: Record<string, unknown>): FormField[] {
  if (fields.length === 0) return [];
  const byOrder = [...fields].sort((a, b) => a.order - b.order);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const reached: FormField[] = [];
  const reachedIds = new Set<string>();
  let current: FormField | null = byOrder[0];

  while (current && !reachedIds.has(current.id)) {
    reachedIds.add(current.id);
    reached.push(current);

    let next: FormField | null = null;
    if (BRANCHING_TYPES.includes(current.question_type)) {
      const answer: unknown = answers[current.id];
      const options: FormFieldOption[] = current.config?.options ?? [];
      const matched = options.find((o) => o.option_id === answer);
      if (matched) {
        if (matched.action === "submit_form") return reached;
        if (matched.next_field_id) next = byId.get(matched.next_field_id) ?? null;
      }
    }
    if (!next) {
      const idx = byOrder.indexOf(current);
      next = idx + 1 < byOrder.length ? byOrder[idx + 1] : null;
    }
    current = next;
  }
  return reached;
}
