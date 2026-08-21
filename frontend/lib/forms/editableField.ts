import { FormField, FormFieldConfig, FormFieldInput } from "@/lib/api";
import { EditableOption } from "@/components/forms/OptionsEditor";

// A field being edited in the builder — same shape as FormField, but `id`
// is null for a not-yet-saved field (PUT .../fields/ creates it on Save,
// per the Edit Lifecycle: an entry with no id means "create"). clientKey is
// the stable React/accordion identity regardless of whether id exists yet.
// showDescription is draft-only UI state: while the description is toggled
// off the text is kept (so re-toggling restores it), and Save is what
// discards it — send `description: showDescription ? description : null`.
export type EditableField = Omit<FormField, "id"> & {
  id: number | null;
  clientKey: string;
  showDescription: boolean;
};

// Attaches a stable clientKey to every option in a loaded field's config —
// options fetched from the server have a real option_id (usable as the key)
// but no clientKey, which OptionsEditor's rows and dnd-kit both need.
export function withOptionClientKeys(field: FormField): FormField {
  if (!field.config?.options?.length) return field;
  return {
    ...field,
    config: {
      ...field.config,
      options: field.config.options.map((opt) => ({ ...opt, clientKey: opt.option_id } as EditableOption)),
    },
  };
}

export function newField(order: number): EditableField {
  return {
    clientKey: crypto.randomUUID(),
    id: null,
    showDescription: false,
    form_id: "",
    field_key: "",
    order,
    label: "",
    description: null,
    question_type: "short_text",
    is_archived: false,
    config: { required: false, max_length: 500 },
    created_at: "",
    updated_at: "",
  };
}

// Builds one PUT .../fields/ payload entry from a staged field. Strips the
// client-only clientKey off every option (the backend's option schemas use
// extra='forbid' — an unrecognized key would 422 the whole batch) and fills
// in the handful of config keys that are Pydantic-required but have no
// corresponding builder control yet (ranks/allow_duplicates default
// silently; confirm_label doesn't — an empty one is caught by
// useFormValidation before a save is ever attempted).
export function toFieldInput(field: EditableField): FormFieldInput {
  const config: FormFieldConfig = { ...(field.config ?? {}) };
  if (config.options) {
    config.options = (config.options as EditableOption[]).map((option) => {
      const { clientKey, ...rest } = option;
      void clientKey;
      return rest;
    });
  }
  if (field.question_type === "ranked_choice") {
    if (config.ranks === undefined) config.ranks = 1;
    if (config.allow_duplicates === undefined) config.allow_duplicates = false;
  }
  return {
    id: field.id ?? undefined,
    field_key: field.field_key.trim(),
    label: field.label.trim(),
    description: field.showDescription ? field.description : null,
    question_type: field.question_type,
    config,
  };
}
