import type { FilterCondition, FilterOp, FilterOptionItem } from "@/lib/api";
import { describeCondition, type FilterField, VALUELESS_OPS } from "@/lib/filters/model";

/**
 * Turns typed text into filter rows: "not day 1" becomes "Track is none of
 * Day 1", "no building" becomes "Building is empty".
 *
 * Plain word matching over the table's own field and option labels, with a
 * few keywords for negation and emptiness. A suggestion with no value yet
 * ("Track status: Day 1") is still worth offering; it adds a row to finish.
 */
export interface QuickAddSuggestion {
  condition: FilterCondition;
  label: string;
  score: number;
}

const NEGATIONS = new Set(["not", "no", "without", "except", "excluding", "isnt", "-"]);
const EMPTINESS = new Set(["empty", "blank", "missing", "none", "unset", "no"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9+-]+/)
    .filter(Boolean);
}

/** How well `tokens` cover `target`: every token must hit some word of it.
 *  0 for a miss; higher for whole words than for prefixes. */
function coverage(tokens: string[], target: string[]): number {
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    for (const word of target) {
      if (word === token) best = Math.max(best, 3);
      else if (word.startsWith(token)) best = Math.max(best, 2);
      else if (token.length >= 3 && word.includes(token)) best = Math.max(best, 1);
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

/** How many of `tokens` hit `target` at all. */
function hits(tokens: string[], target: string[]): number {
  return tokens.filter((token) => target.some((word) => word.startsWith(token))).length;
}

function allowed(field: FilterField<never>, op: FilterOp): FilterOp | null {
  return field.ops.includes(op) ? op : null;
}

export function suggestConditions(
  query: string,
  fields: FilterField<never>[],
  limit = 8,
): QuickAddSuggestion[] {
  const raw = words(query.trim().startsWith("-") ? `- ${query.trim().slice(1)}` : query);
  if (raw.length === 0) return [];
  const negated = raw.some((word) => NEGATIONS.has(word));
  const saysNot = raw.some((word) => NEGATIONS.has(word) && word !== "no");
  // "no" alone reads as emptiness ("no building"); "not empty" flips it.
  const saysEmpty = raw.some((word) => EMPTINESS.has(word) && word !== "no");
  const tokens = raw.filter((word) => !NEGATIONS.has(word) && !EMPTINESS.has(word));

  /** The operator for a row that names a field (or a group) but no value. */
  const bareOp = (field: FilterField<never>): FilterOp | null => {
    if (saysEmpty) return allowed(field, saysNot ? "not_empty" : "empty");
    if (raw.includes("no")) return allowed(field, "empty");
    return field.ops[0];
  };

  const out = new Map<string, QuickAddSuggestion>();
  const offer = (field: FilterField<never>, condition: FilterCondition, score: number) => {
    if (score <= 0) return;
    const label = describeCondition(condition, field);
    const existing = out.get(label);
    if (!existing || existing.score < score) out.set(label, { condition, label, score });
  };

  for (const field of fields) {
    const fieldWords = words(field.label);
    const offerValue = (
      option: FilterOptionItem,
      group: FilterOptionItem | null,
      extra: string[],
    ) => {
      const optionWords = words(option.label);
      const target = [...fieldWords, ...extra, ...optionWords];
      const score = coverage(tokens, target);
      // The option itself has to be named; the field name alone is the
      // field-level suggestion below.
      if (score === 0 || hits(tokens, optionWords) === 0) return;
      const op = allowed(field, negated ? "none_of" : "any_of");
      if (!op) return;
      offer(
        field,
        { field: field.key, group: group?.value ?? null, op, values: [option.value] },
        score + 2,
      );
    };

    if (field.groups) {
      for (const group of field.groups) {
        const groupWords = words(group.label);
        for (const option of group.options) offerValue(option, group, groupWords);
        // Naming the group without an option: emptiness if asked for,
        // otherwise a row to finish.
        const target = [...fieldWords, ...groupWords];
        const score = coverage(tokens, target);
        const op = bareOp(field);
        if (score > 0 && hits(tokens, groupWords) > 0 && op) {
          offer(field, { field: field.key, group: group.value, op, values: [] }, score);
        }
      }
    } else {
      for (const option of field.options ?? []) offerValue(option, null, []);
    }

    // The field alone: "no building" is emptiness, "building" a row to finish.
    const score = tokens.length > 0 ? coverage(tokens, fieldWords) : 0;
    const op = bareOp(field);
    if (score > 0 && !field.groups && op) {
      const bonus = VALUELESS_OPS.has(op) ? 1 : 0;
      offer(field, { field: field.key, group: null, op, values: [] }, score + bonus);
    }
  }

  return [...out.values()]
    .sort((a, b) => b.score - a.score || a.label.length - b.label.length)
    .slice(0, limit);
}
