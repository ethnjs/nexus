import { FormField, FormFieldConfig, FormFieldInput } from "@/lib/api";
import { EditableOption } from "@/components/forms/OptionsEditor";
import { effectiveFieldKey } from "@/lib/forms/fieldKeyPresets";

// A field being edited in the builder — same shape as FormField, but `id`
// is null for a not-yet-saved field (PUT .../fields/ creates it on Save,
// per the Edit Lifecycle: an entry with no id means "create"). clientKey is
// the stable React/accordion identity regardless of whether id exists yet.
// showDescription is draft-only UI state: while the description is toggled
// off the text is kept (so re-toggling restores it), and Save is what
// discards it — send `description: showDescription ? description : null`.
// branchingEnabled/customValuesEnabled are the same kind of draft-only UI
// state, now living on the field (not a component's local useState) so they
// survive FieldToolbar remounting on every expanded-field switch — see
// deriveBranchingEnabled/deriveCustomValuesEnabled below for how a loaded
// field's initial value is worked out from its actual option data.
export type EditableField = Omit<FormField, "id"> & {
  id: string | null;
  clientKey: string;
  showDescription: boolean;
  branchingEnabled: boolean;
  customValuesEnabled: boolean;
};

// A field's options actually use branching/custom values yet — used to seed
// branchingEnabled/customValuesEnabled when a field is first loaded (or
// reloaded after Save), so the toggle reflects real data instead of
// defaulting to off and hiding a branch/value an earlier session set up.
export function deriveBranchingEnabled(field: FormField): boolean {
  return (field.config?.options ?? []).some((o) => o.next_field_id != null || o.action != null);
}

export function deriveCustomValuesEnabled(field: FormField): boolean {
  return (field.config?.options ?? []).some((o) => typeof o.value === "string" && o.value !== o.label);
}

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
    branchingEnabled: false,
    customValuesEnabled: false,
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
// corresponding builder control yet (ranks/allow_duplicates/max_length
// default silently; confirm_label doesn't — an empty one is caught by
// useFormValidation before a save is ever attempted). max_length in
// particular can go missing when a field switches types and back — e.g.
// short_text -> ranked_choice -> short_text leaves it stripped by
// sanitizeConfigForType on the way in, since ranked_choice's config schema
// doesn't carry it either.
export function toFieldInput(field: EditableField, notifyResponders?: boolean): FormFieldInput {
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
  if ((field.question_type === "short_text" || field.question_type === "long_text") && config.max_length === undefined) {
    config.max_length = 500;
  }
  // FieldCard auto-syncs field_key from label live, but that's a UI
  // convenience, not a guarantee — a duplicated field or one whose label
  // was pasted in without ever touching the label input again could still
  // reach Save with an empty key. Same fallback either way: the label's
  // own slug, matching what the TD would see if they'd typed it themselves.
  const fieldKey = effectiveFieldKey(field);
  return {
    id: field.id ?? undefined,
    field_key: fieldKey,
    label: field.label.trim(),
    description: field.showDescription ? field.description : null,
    question_type: field.question_type,
    config,
    // Omitted unless the confirmation modal actually asked — the server falls
    // back to each change's own default, which is what an unprompted save
    // (draft form, or nothing consequential changed) should get.
    ...(notifyResponders === undefined ? {} : { notify_responders: notifyResponders }),
  };
}
