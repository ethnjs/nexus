import type { FormField, FormFieldOption } from "@/lib/api";

// Custom values: an option's stored `value` differs from the label respondents
// see (e.g. label "Yes, I'll be there", value "yes"). Off by default, where
// the value just follows the label.

export function hasCustomValues(options: FormFieldOption[] | null | undefined): boolean {
  return (options ?? []).some((o) => typeof o.value === "string" && o.value !== o.label);
}

// Seeds the builder's custom-values toggle from a loaded field, so it reflects
// real data instead of hiding values an earlier session set up.
export function deriveCustomValuesEnabled(field: FormField): boolean {
  return hasCustomValues(field.config?.options);
}

// Turning custom values off folds each value back into its label, so turning
// it on again later starts clean.
export function withoutCustomValues<T extends FormFieldOption>(options: T[]): T[] {
  return options.map((o) => ({ ...o, value: o.label }));
}
