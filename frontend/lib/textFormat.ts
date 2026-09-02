// "test_review" -> "Test Review". Reserved-key suffixes and field_keys are
// slugs meant for lookup, never for a person to read — mirrors the backend's
// display_config.unslug so a panel label and its display-config toggle read
// identically.
export function unslug(text: string): string {
  return text
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
