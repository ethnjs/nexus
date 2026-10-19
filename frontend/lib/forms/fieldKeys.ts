// Shared slug rule for every TD-typed field_key: a plain question's
// auto-derived key, or a part of an add-on's reserved key. Empty when the text
// slugifies to nothing (e.g. only punctuation), so a key stays blank rather
// than silently becoming "_" or similar noise.
export function slugifyFieldKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// The field_key a field will actually save with — its own typed key if set,
// else the label's slug. Shared by toFieldInput (what's sent to the
// backend) and useFormValidation (what's checked for duplicates) so the two
// can't disagree about what a blank-key field's real key is.
export function effectiveFieldKey(field: { field_key: string; label: string }): string {
  return field.field_key.trim() || slugifyFieldKey(field.label);
}

// Whether a validation message is about field_key specifically (vs.
// label/options/etc.) — matches both "Field key is required." and "This field
// key is already used by another question...". Shared so FieldCard's error
// list and FieldKeyPopover's danger styling agree on what counts as a key error.
export function isFieldKeyError(message: string): boolean {
  return /field key|key is/i.test(message);
}
