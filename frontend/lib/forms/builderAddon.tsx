"use client";

import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import type { EditableOption } from "@/components/forms/builder/OptionsEditor";
import type {
  FieldKeyUsage,
  Form,
  FormFieldConfig,
  FormFieldOption,
  FormQuestionType,
} from "@/lib/api";
import type { BranchTarget } from "@/lib/forms/branching";
import type { EditableField } from "@/lib/forms/editableField";

// The form builder's extension point. The core builder (question types,
// options, branching, custom values, keys) stands on its own; an add-on layers
// owner-specific question kinds on top of it, such as the tournament presets
// in lib/forms/tournament/. The core reaches add-on behavior only through this
// interface, and the page picks the add-on, so core code never imports one.

export interface ExtendableField {
  field_key: string;
  question_type: FormQuestionType;
  config: FormFieldConfig | null;
}

/** How an add-on changes one field. Every key is optional; absent means core behavior. */
export interface FieldExtension {
  /** Set when the add-on owns this field's key: the key popover locks and shows this. */
  keyLockedReason?: string;
  allowedQuestionTypes?: FormQuestionType[];
  requiredLocked?: boolean;
  /** Defaults to true. */
  allowsCustomValues?: boolean;
  hideAllowDuplicates?: boolean;
  /** Whether the TD may add an Other choice. Defaults to true. */
  allowsOther?: boolean;
  /** Seeds a new option row, for add-ons whose option `value` isn't text. */
  newOption?: () => EditableOption;
  /** A duplicate keeps the source's key, and the add-on's popover opens to make it distinct. */
  keepsKeyOnDuplicate?: boolean;
  /** Replaces the core options editor for this field. */
  OptionsEditor?: ComponentType<AddonOptionsEditorProps>;
}

export interface AddonOptionsEditorProps {
  field: ExtendableField;
  options: EditableOption[];
  onChange: (options: EditableOption[]) => void;
  displayStyle?: "list" | "buttons";
  branchTargets?: BranchTarget[];
  errors: string[];
  allowArchive: boolean;
  /** Opens this field's add-on popover with its incomplete state flagged. */
  onOpenAddon?: () => void;
}

export interface AddonToolbarProps {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
  allFields: EditableField[];
  errors: string[];
  /** Bumped on every failed Save, so the popover can open itself on an error. */
  saveAttempt: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set when the card body sent the TD here — show what's incomplete right away. */
  demand: boolean;
}

export interface FormBuilderAddon {
  /** Wraps the builder and loads whatever the add-on's hooks and components read. */
  Provider: ComponentType<{ form: Form; children: ReactNode }>;
  /** Per-field behavior. Pure, so the core can ask from event handlers too. */
  extendField: (field: ExtendableField) => FieldExtension;
  /** The collapsed preview's text for an option, when it needs the add-on's
   *  data (e.g. a shift's times). Undefined keeps the option's own label. */
  useOptionLabel: (field: ExtendableField) => ((option: FormFieldOption) => string) | undefined;
  /** Keys other forms with this form's owner use, for the key picker to suggest. */
  useSharedFieldKeys: () => FieldKeyUsage[];
  /** The add-on's toolbar button and popover. */
  Toolbar: ComponentType<AddonToolbarProps> | null;
  /** Validation the core runs alongside its own. */
  issuesFor: (field: ExtendableField, fields: ExtendableField[]) => string[];
  /** Messages shown in the add-on's popover instead of on the field card. */
  ownsIssue: (message: string) => boolean;
}

export const NO_EXTENSION: FieldExtension = {};
const NO_KEYS: FieldKeyUsage[] = [];

function PassThrough({ children }: { form: Form; children: ReactNode }) {
  return children;
}

/** Stands in when a form has no add-on, so core code calls the same hooks either way. */
export const CORE_ONLY: FormBuilderAddon = {
  Provider: PassThrough,
  extendField: () => NO_EXTENSION,
  useOptionLabel: () => undefined,
  useSharedFieldKeys: () => NO_KEYS,
  Toolbar: null,
  issuesFor: () => [],
  ownsIssue: () => false,
};

const FormBuilderAddonContext = createContext<FormBuilderAddon>(CORE_ONLY);

/** Provides the add-on to the builder and mounts its Provider around it. */
export function FormBuilderAddonScope({
  addon,
  form,
  children,
}: {
  addon: FormBuilderAddon;
  form: Form;
  children: ReactNode;
}) {
  const { Provider } = addon;
  return (
    <FormBuilderAddonContext.Provider value={addon}>
      <Provider form={form}>{children}</Provider>
    </FormBuilderAddonContext.Provider>
  );
}

export function useFormBuilderAddon(): FormBuilderAddon {
  return useContext(FormBuilderAddonContext);
}

export function useFieldExtension(field: ExtendableField): FieldExtension {
  return useFormBuilderAddon().extendField(field);
}

export function useOptionLabel(
  field: ExtendableField,
): ((option: FormFieldOption) => string) | undefined {
  return useFormBuilderAddon().useOptionLabel(field);
}
