// An Other pick is submitted as {option_id, text} in place of the bare
// option_id, alone for a single select or as one item of a checkbox list.

export const OTHER_LABEL = "Other";
// Matches OTHER_TEXT_MAX_LENGTH in backend/app/core/form/branching.py.
export const OTHER_TEXT_MAX_LENGTH = 500;

export interface OtherAnswer {
  option_id: string;
  text: string;
}

export function isOtherAnswer(item: unknown): item is OtherAnswer {
  return item !== null && typeof item === "object" && "option_id" in item && "text" in item;
}

/** The option an answer item picked, whether or not it's an Other pick. */
export function pickedOptionId(item: unknown): unknown {
  return isOtherAnswer(item) ? item.option_id : item;
}

/** Other was picked but left without text. */
export function hasBlankOther(value: unknown): boolean {
  const items = Array.isArray(value) ? value : [value];
  return items.some((item) => isOtherAnswer(item) && !item.text.trim());
}
