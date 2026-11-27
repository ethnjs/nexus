import type { FilterCondition, FilterOp, FilterOptionItem } from "@/lib/api";
import {
  describeCondition,
  type FilterField,
  newCondition,
  VALUELESS_OPS,
} from "@/lib/filters/model";

/**
 * Turns typed text into filter rows: "not day 1" becomes "Track is none of
 * Day 1", "no building" becomes "Building is empty", "anat" finds Anatomy.
 *
 * Word matching over the table's own field, group and option labels, with a
 * few keywords for negation and emptiness. Every typed word has to land
 * somewhere in a suggestion; how well each lands, and whether the value
 * itself was named, decides the order.
 */
export interface QuickAddSuggestion {
  condition: FilterCondition;
  label: string;
  score: number;
}

const NEGATIONS = new Set(["not", "no", "without", "except", "excluding", "isnt", "-"]);
const EMPTINESS = new Set(["empty", "blank", "missing", "none", "unset", "unanswered"]);
// Words that read naturally ("who is on day 1") but name nothing.
const FILLER = new Set(["is", "are", "of", "any", "the", "a", "an", "with", "in", "who", "has"]);
// Per field, so one long list (every role, every event) can't crowd out the rest.
const PER_FIELD = 4;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9+-]+/)
    .filter(Boolean);
}

/** Whether `token`'s letters appear in `word` in order ("phys" in "physiology"). */
function isSubsequence(token: string, word: string): boolean {
  let at = 0;
  for (const char of word) if (char === token[at]) at++;
  return at === token.length;
}

/** How well one typed word matches one of `target`'s; 0 for not at all. */
function tokenScore(token: string, target: string[]): number {
  let best = 0;
  for (const word of target) {
    if (word === token) return 4;
    if (word.startsWith(token)) best = Math.max(best, 3);
    else if (token.length >= 3 && word.includes(token)) best = Math.max(best, 2);
    else if (token.length >= 3 && word[0] === token[0] && isSubsequence(token, word)) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

/** Every token's best match across the parts, and how many landed in each;
 *  null if any token misses them all. */
function cover(tokens: string[], parts: string[][]): { score: number; hits: number[] } | null {
  const hits = parts.map(() => 0);
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    let where = -1;
    parts.forEach((part, i) => {
      const s = tokenScore(token, part);
      if (s > best) {
        best = s;
        where = i;
      }
    });
    if (best === 0) return null;
    score += best;
    hits[where]++;
  }
  return { score, hits };
}

function allowed(field: FilterField<never>, op: FilterOp): FilterOp | null {
  return field.ops.includes(op) ? op : null;
}

/** With nothing typed: one starter row per field, to pick from. */
function starters(fields: FilterField<never>[]): QuickAddSuggestion[] {
  return fields.map((field) => ({
    condition: newCondition(field),
    label: `${field.label}…`,
    score: 0,
  }));
}

export function suggestConditions(
  query: string,
  fields: FilterField<never>[],
  limit = 8,
): QuickAddSuggestion[] {
  const trimmed = query.trim();
  const raw = words(trimmed.startsWith("-") ? `- ${trimmed.slice(1)}` : trimmed);
  if (raw.length === 0) return starters(fields);

  const negated = raw.some((word) => NEGATIONS.has(word));
  const saysNot = raw.some((word) => NEGATIONS.has(word) && word !== "no");
  // "no" alone reads as emptiness ("no building"); "not empty" flips it.
  const saysEmpty = raw.some((word) => EMPTINESS.has(word));
  const tokens = raw.filter(
    (word) => !NEGATIONS.has(word) && !EMPTINESS.has(word) && !FILLER.has(word),
  );
  const phrase = tokens.join(" ");

  /** The operator for a row that names a field (or a group) but no value. */
  const bareOp = (field: FilterField<never>): FilterOp | null => {
    if (saysEmpty) return allowed(field, saysNot ? "not_empty" : "empty");
    if (raw.includes("no")) return allowed(field, "empty");
    return field.ops[0];
  };

  const found: (QuickAddSuggestion & { field: string })[] = [];
  const offer = (field: FilterField<never>, condition: FilterCondition, score: number) => {
    found.push({ field: field.key, condition, label: describeCondition(condition, field), score });
  };

  for (const field of fields) {
    const fieldWords = words(field.label);

    const offerValue = (option: FilterOptionItem, group: FilterOptionItem | null) => {
      const optionWords = words(option.label);
      const match = cover(tokens, [optionWords, group ? words(group.label) : [], fieldWords]);
      // The value has to be named; naming only the field is the row below.
      if (!match || match.hits[0] === 0) return;
      const op = allowed(field, negated ? "none_of" : "any_of");
      if (!op) return;
      let score = match.score + 2 * match.hits[0];
      if (phrase && option.label.toLowerCase().includes(phrase)) score += 4;
      score -= option.label.length / 40;
      offer(
        field,
        { field: field.key, group: group?.value ?? null, op, values: [option.value] },
        score,
      );
    };

    if (field.groups) {
      for (const group of field.groups) {
        for (const option of group.options) offerValue(option, group);
        const match = cover(tokens, [words(group.label), fieldWords]);
        const op = bareOp(field);
        if (match && match.hits[0] > 0 && op) {
          offer(field, { field: field.key, group: group.value, op, values: [] }, match.score);
        }
      }
    } else {
      for (const option of field.options ?? []) offerValue(option, null);
    }

    // A field's own wording for emptiness: "unassigned", "not answered".
    for (const op of field.ops) {
      const wording = field.opLabels?.[op];
      if (!wording || !VALUELESS_OPS.has(op)) continue;
      const opWords = words(wording).filter((word) => !FILLER.has(word));
      for (const group of field.groups ?? [null]) {
        const match = cover(tokens, [opWords, group ? words(group.label) : [], fieldWords]);
        if (!match || match.hits[0] === 0) continue;
        const condition = { ...newCondition(field), op };
        offer(field, group ? { ...condition, group: group.value } : condition, match.score + 3);
      }
    }

    // The field alone: "no building" is emptiness, "building" a row to finish
    // (picking its track next, for a field with several).
    const match = tokens.length > 0 ? cover(tokens, [fieldWords]) : null;
    const op = bareOp(field);
    if (match && op) {
      offer(
        field,
        { ...newCondition(field), op },
        match.score + (VALUELESS_OPS.has(op) ? 2 : 0) + 1,
      );
    }
  }

  found.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
  const perField = new Map<string, number>();
  const seen = new Set<string>();
  const out: QuickAddSuggestion[] = [];
  for (const { field, ...suggestion } of found) {
    if (seen.has(suggestion.label)) continue;
    const count = perField.get(field) ?? 0;
    if (count >= PER_FIELD) continue;
    seen.add(suggestion.label);
    perField.set(field, count + 1);
    out.push(suggestion);
    if (out.length === limit) break;
  }
  return out;
}
