"use client";

import { type ReactNode, useState } from "react";
import { type EditableOption, OptionsEditor } from "@/components/forms/builder/OptionsEditor";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Checkbox } from "@/components/ui/Checkbox";
import { CheckboxList } from "@/components/ui/CheckboxList";
import { Dropdown } from "@/components/ui/Dropdown";
import { FormattedText } from "@/components/ui/FormattedText";
import { IconX } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { RadioList } from "@/components/ui/RadioList";
import { RankedList } from "@/components/ui/RankedList";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import type {
  FormFieldConfig,
  FormFieldOption,
  FormQuestionType,
  ResolvedShiftOption,
} from "@/lib/api";
import type { BranchTarget } from "@/lib/forms/branching";
import { type ExtendableField, useFieldExtension } from "@/lib/forms/builderAddon";
import { BRANCHING_TYPES, OPTION_BEARING_TYPES, OTHER_TYPES } from "@/lib/forms/fieldTypes";
import {
  isOtherAnswer,
  OTHER_LABEL,
  OTHER_TEXT_MAX_LENGTH,
  pickedOptionId,
} from "@/lib/forms/otherAnswer";
import { formatTimeRange } from "@/lib/timeFormat";

// Only what rendering actually needs — not the full persisted FormField
// (id, form_id, timestamps, ...), so an in-progress/unsaved draft field in
// the builder (no id yet) can be rendered without a fake id to satisfy the type.
// field_key is optional and only consulted by edit mode (an add-on recognizes
// its own questions by it); view mode never reads it.
export interface QuestionFieldData {
  label: string;
  description: string | null;
  question_type: FormQuestionType;
  config: FormFieldConfig | null;
  field_key?: string;
}

type FieldUpdate = Partial<QuestionFieldData>;

interface QuestionRendererProps {
  field: QuestionFieldData;
  /** 'view' (default) = respondent-facing rendering, either a live answer widget
      (interactive) or a read-only preview. 'edit' = the TD-facing config editor
      for this question_type's body (options list, ranks, confirm text, ...). */
  mode?: "view" | "edit";
  /** view mode only. false = read-only preview (the builder's collapsed card
      state); true = a real respondent can answer. */
  interactive?: boolean;
  /** view mode, interactive only — the question still shows the answer given,
      but every input is locked. Distinct from `interactive: false`, which is a
      blank preview: this is an answer that exists and can't be changed right
      now (e.g. a track the member has declined). */
  locked?: boolean;
  /** view mode only. Shape depends on question_type (string for text types,
      boolean for acknowledgment, ...). */
  value?: unknown;
  onChange?: (value: unknown) => void;
  /** view mode, interactive only — validation message for this field, shown
      inline where the question type has somewhere to put it (currently just
      ranked_choice's add-combobox; other types don't have an equivalent
      inline slot yet, so the caller still has to render its own message for
      them). Not used at all in edit mode — see the `errors` prop instead. */
  error?: string;
  /** view mode only — overrides an option's text, for the builder's preview of
      an add-on question whose `value` is still raw ids (see useOptionLabel). */
  optionLabel?: (option: FormFieldOption) => string;
  /** Hide the label/description header — e.g. the builder's expanded card already
      shows the label via its own editable Input, so repeating it here would be
      redundant. */
  showHeader?: boolean;
  /** edit mode only — applies a partial update to the field being edited. */
  onFieldChange?: (updates: FieldUpdate) => void;
  /** edit mode only — candidate "jump to" fields for single_select_radio/dropdown's
      per-option branching. Omitted (or empty) hides the branch dropdown. */
  branchTargets?: BranchTarget[];
  /** edit mode only — whether branching is currently toggled on for this field
      (the toggle itself lives outside QuestionRenderer, in FieldToolbar). */
  branchingEnabled?: boolean;
  /** edit mode only — whether this field's options currently show a separate
      value input (freeform types only — entity-backed presets ignore this,
      their value is always the picked entity ids). Toggle lives in
      FieldToolbar, same as branchingEnabled. */
  customValuesEnabled?: boolean;
  /** edit mode only — whether archiving an option is a meaningful choice,
      i.e. the form already has responses. On a form nobody has answered
      there's nothing to preserve, so removing an option just removes it and
      the extra control would be noise. */
  allowArchive?: boolean;
  /** edit mode only — forwarded to an add-on's options editor; see AddonOptionsEditorProps. */
  onOpenAddon?: () => void;
  /** Read-only answers only — options a past answer picked that are no longer
      offered (archived, or gone from config). Shown in line with the live
      ones, marked Removed, so the answer still reads as given. */
  removedOptions?: FormFieldOption[];
  /** Rendered in place of the input, under the question — e.g. "Not
      answered" in a read-only response. */
  answerNote?: ReactNode;
  /** edit mode only — this field's useFormValidation messages (label/key
      errors are handled by the caller — see FieldCard — so only the
      body-relevant ones need to reach here: confirmation text, options,
      ranks). Each body works out for itself which of its own inputs a given
      message belongs to, rather than the message carrying that routing. */
  errors?: string[];
}

// Shared between the builder's field-card preview/editor (mode='view'/'edit')
// and the eventual /preview and /view pages (mode='view', interactive=true) —
// one place that knows how each question_type both answers and edits, so the
// builder's editor and a respondent's view never drift apart. Reserved-key
// entity grouping (availability/event_preference) mostly doesn't affect view
// mode — it only ever reads an option's `label`, not its raw `value` — except
// availability, where GET /forms/{id}/ resolves `value` into each grouped
// shift's own start/end (see optionDisplayLabel) so the option can show its
// time range alongside the TD-typed label.
export function QuestionRenderer({
  field,
  mode = "view",
  interactive = false,
  locked = false,
  value,
  onChange,
  error,
  optionLabel,
  showHeader = true,
  onFieldChange,
  branchTargets,
  branchingEnabled,
  customValuesEnabled,
  errors = [],
  allowArchive = false,
  onOpenAddon,
  removedOptions,
  answerNote,
}: QuestionRendererProps) {
  const config = field.config ?? {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {showHeader && (
        <div>
          {/* data-focus marks which editor input a click here corresponds to,
              so the builder's collapsed card can open straight into it. Inert
              everywhere else. */}
          <span
            data-focus="label"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            <FormattedText
              markdown={field.label || "Untitled question"}
              variant="inline"
              trailing={
                config.required ? (
                  <span style={{ color: "var(--color-danger)" }}> *</span>
                ) : undefined
              }
            />
          </span>
          {field.description && (
            <div
              data-focus="description"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                color: "var(--color-text-secondary)",
                marginTop: "4px",
              }}
            >
              <FormattedText markdown={field.description} variant="rich" />
            </div>
          )}
        </div>
      )}

      {answerNote !== undefined && mode !== "edit" ? (
        answerNote
      ) : mode === "edit" ? (
        <QuestionEditBody
          field={field}
          onFieldChange={onFieldChange ?? (() => {})}
          branchTargets={branchTargets}
          branchingEnabled={branchingEnabled}
          customValuesEnabled={customValuesEnabled}
          errors={errors}
          allowArchive={allowArchive}
          onOpenAddon={onOpenAddon}
        />
      ) : (
        <QuestionBody
          field={field}
          interactive={interactive}
          locked={locked}
          value={value}
          onChange={onChange}
          error={error}
          optionLabel={optionLabel}
          removedOptions={removedOptions}
        />
      )}
    </div>
  );
}

type OtherDraft = { key: string; text: string };

function newOtherDraft(text = ""): OtherDraft {
  return { key: crypto.randomUUID(), text };
}

// ResolvedEventOption[] is also an array of objects, so 'start' is what tells
// the two resolved shapes apart — event options must never get a time range.
function isResolvedShiftOptions(value: FormFieldOption["value"]): value is ResolvedShiftOption[] {
  return (
    Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && "start" in value[0]
  );
}

// An availability option with track statuses wraps its shifts in `{shifts, track_statuses}`.
function resolvedShifts(value: FormFieldOption["value"]): ResolvedShiftOption[] | null {
  const shifts = typeof value === "object" && !Array.isArray(value) ? value.shifts : value;
  return shifts && isResolvedShiftOptions(shifts) ? shifts : null;
}

// Appends the span across every shift grouped under an availability option,
// so "All Day" reads as "All Day (7:00 AM–5:00 PM)". The builder's preview
// still has raw ids and gets its text from `optionLabel` instead.
function optionDisplayLabel(option: FormFieldOption): string {
  const shifts = resolvedShifts(option.value);
  return shifts ? `${option.label} (${formatTimeRange(shifts)})` : option.label;
}

function QuestionBody({
  field,
  interactive,
  locked,
  value,
  onChange,
  error,
  optionLabel = optionDisplayLabel,
  removedOptions = [],
}: {
  field: QuestionFieldData;
  interactive?: boolean;
  value?: unknown;
  onChange?: (value: unknown) => void;
  error?: string;
  optionLabel?: (option: FormFieldOption) => string;
  locked?: boolean;
  removedOptions?: FormFieldOption[];
}) {
  const config = field.config ?? {};
  // What's typed in the Other field(s). Drafts outlive unpicking Other so the text stays on
  // screen and comes back on a re-pick, but only the answer is submitted, and it drops Other.
  // A single select uses the first; a checkbox question can add more with Enter.
  const [otherDrafts, setOtherDrafts] = useState<OtherDraft[]>(() => {
    const items = Array.isArray(value) ? value : [value];
    const texts = items.filter(isOtherAnswer).map((item) => item.text);
    return (texts.length > 0 ? texts : [""]).map((text) => newOtherDraft(text));
  });
  const [focusOtherKey, setFocusOtherKey] = useState<string | null>(null);
  const labelFor =
    config.show_shift_times === false ? (opt: FormFieldOption) => opt.label : optionLabel;
  // Locked keeps the answer on screen but refuses edits, so every input is
  // locked and every handler is a no-op. `interactive` still decides whether
  // there is an answer to show at all.
  const editable = interactive && !locked;
  // An archived option stays in `config.options` so old answers referencing
  // its option_id keep resolving; it's storage, never a choice to present.
  const removedIds = new Set(removedOptions.map((opt) => opt.option_id));
  const liveOptions: FormFieldOption[] = [
    ...(config.options ?? []).filter((opt) => !opt.is_archived && !removedIds.has(opt.option_id)),
    ...removedOptions,
  ];
  const badgeFor = (optionId: string) =>
    removedIds.has(optionId) ? <Badge variant="declined">Removed</Badge> : undefined;
  const otherOptionId = liveOptions.find((opt) => opt.is_other)?.option_id;
  // As in Google Forms, the Other field shows whenever the question offers Other, and typing
  // in it picks Other. A read-only answer shows it only when Other was the pick.
  const showsOtherField = (picked: boolean) =>
    picked || (!!otherOptionId && !(interactive && !editable));
  // A list row holds the field in place of the Other label. An answer whose Other option is
  // gone from the question has no row to sit in.
  const hasOtherRow = (pickedOtherId: string | undefined) =>
    config.display_style !== "buttons" &&
    !!otherOptionId &&
    (!pickedOtherId || pickedOtherId === otherOptionId);
  function otherInput(
    text: string,
    onText: (text: string) => void,
    {
      inline = false,
      autoFocus = false,
      onEnter,
      onRemove,
    }: { inline?: boolean; autoFocus?: boolean; onEnter?: () => void; onRemove?: () => void } = {},
  ) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <div style={inline ? { width: "min(320px, 60vw)" } : { flex: 1 }}>
          <Input
            font="sans"
            value={text}
            onChange={(e) => editable && onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !onEnter || !editable) return;
              e.preventDefault();
              onEnter();
            }}
            placeholder={OTHER_LABEL}
            maxLength={OTHER_TEXT_MAX_LENGTH}
            locked={!editable}
            autoFocus={autoFocus}
            fullWidth
          />
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            iconOnly
            title="Remove"
            onClick={onRemove}
          >
            <IconX size={12} />
          </Button>
        )}
      </div>
    );
  }
  function withOtherFields(control: ReactNode, fields: ReactNode[], indent = 0) {
    if (fields.length === 0) return control;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {control}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginLeft: indent }}>
          {fields}
        </div>
      </div>
    );
  }

  // A single select's answer: the picked option_id, or {option_id, text} for Other.
  const singleOther = interactive && isOtherAnswer(value) ? value : null;
  const singleSelected = interactive ? String(pickedOptionId(value) ?? "") : "";
  const singleOtherText = singleOther?.text ?? (editable ? otherDrafts[0].text : "");
  function pickSingle(optionId: string) {
    if (!editable) return;
    onChange?.(
      optionId === otherOptionId
        ? { option_id: optionId, text: singleOther?.text ?? otherDrafts[0].text }
        : optionId,
    );
  }
  function setSingleOtherText(text: string) {
    setOtherDrafts([{ ...otherDrafts[0], text }]);
    const optionId = singleOther?.option_id ?? otherOptionId;
    if (optionId) onChange?.({ option_id: optionId, text });
  }
  const singleShowsOther = showsOtherField(!!singleOther);

  switch (field.question_type) {
    case "short_text":
      return (
        <Input
          font="sans"
          value={interactive ? ((value as string | undefined) ?? "") : ""}
          onChange={(e) => editable && onChange?.(e.target.value)}
          placeholder={interactive ? undefined : "Short answer"}
          locked={!editable}
          fullWidth
        />
      );

    case "long_text":
      return (
        <Textarea
          font="sans"
          value={interactive ? ((value as string | undefined) ?? "") : ""}
          onChange={(e) => editable && onChange?.(e.target.value)}
          placeholder={interactive ? undefined : "Long answer"}
          disabled={!editable}
          rows={3}
          fullWidth
        />
      );

    case "acknowledgment":
      return (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            cursor: editable ? "pointer" : "default",
          }}
        >
          <Checkbox
            checked={interactive ? Boolean(value) : false}
            onChange={(checked) => editable && onChange?.(checked)}
            locked={!editable}
            size={18}
          />
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              color: "var(--color-text-secondary)",
            }}
          >
            {config.confirm_label || "I understand"}
          </span>
        </label>
      );

    case "single_select_radio": {
      const options = liveOptions;
      const inline = hasOtherRow(singleOther?.option_id);
      const displayOptions = options.map((opt) => ({
        value: opt.option_id,
        label: labelFor(opt),
        badge: badgeFor(opt.option_id),
        content:
          inline && singleShowsOther && opt.option_id === otherOptionId
            ? otherInput(singleOtherText, setSingleOtherText, { inline: true })
            : undefined,
      }));

      const control =
        config.display_style === "buttons" ? (
          <ButtonGroup
            options={displayOptions}
            value={singleSelected}
            onChange={pickSingle}
            locked={!editable}
            clickThrough={!interactive}
          />
        ) : (
          <RadioList
            options={displayOptions}
            value={singleSelected}
            onChange={pickSingle}
            locked={!editable}
            size={19}
            fontSize="16px"
            gap="8px"
          />
        );
      return inline || !singleShowsOther
        ? control
        : withOtherFields(control, [otherInput(singleOtherText, setSingleOtherText)]);
    }

    case "single_select_dropdown": {
      const options = liveOptions;
      const dropdown = (
        <Dropdown
          value={singleSelected}
          onChange={pickSingle}
          options={options.map((opt) => ({
            value: opt.option_id,
            label: opt.label,
            badge: badgeFor(opt.option_id),
          }))}
          placeholder="Choose"
          locked={!editable}
          fullWidth
        />
      );
      return singleShowsOther
        ? withOtherFields(dropdown, [otherInput(singleOtherText, setSingleOtherText)])
        : dropdown;
    }

    case "multi_select_checkbox": {
      const options = liveOptions;
      // Each item is an option_id, or {option_id, text} for Other.
      const items = interactive ? ((value as unknown[] | undefined) ?? []) : [];
      const selected = items.map((item) => String(pickedOptionId(item)));
      const otherItems = items.filter(isOtherAnswer);
      const otherId = otherOptionId ?? otherItems[0]?.option_id;
      const otherChecked = otherItems.length > 0;
      const inline = hasOtherRow(otherItems[0]?.option_id);

      // Blank drafts aren't submitted. A checked Other with nothing typed still sends one
      // blank entry, so the "type your answer" check catches it.
      function commitOther(drafts: OtherDraft[], checked: boolean) {
        setOtherDrafts(drafts);
        const rest = items.filter((item) => pickedOptionId(item) !== otherId);
        if (!checked || !otherId) return onChange?.(rest);
        const texts = drafts.map((d) => d.text).filter((text) => text.trim());
        onChange?.([
          ...rest,
          ...(texts.length > 0 ? texts : [""]).map((text) => ({ option_id: otherId, text })),
        ]);
      }
      function toggle(optionId: string) {
        if (!editable) return;
        if (optionId === otherId) return commitOther(otherDrafts, !otherChecked);
        onChange?.(
          selected.includes(optionId)
            ? items.filter((item) => pickedOptionId(item) !== optionId)
            : [...items, optionId],
        );
      }
      function addOtherAfter(index: number) {
        const added = newOtherDraft();
        setOtherDrafts([
          ...otherDrafts.slice(0, index + 1),
          added,
          ...otherDrafts.slice(index + 1),
        ]);
        setFocusOtherKey(added.key);
      }

      const entries: OtherDraft[] = editable
        ? otherDrafts
        : otherItems.length > 0
          ? otherItems.map((item, i) => ({ key: String(i), text: item.text }))
          : [{ key: "0", text: "" }];
      const otherFields = showsOtherField(otherChecked)
        ? entries.map((draft, i) => (
            <div key={draft.key}>
              {otherInput(
                draft.text,
                (text) =>
                  commitOther(
                    otherDrafts.map((d) => (d.key === draft.key ? { ...d, text } : d)),
                    true,
                  ),
                {
                  inline,
                  autoFocus: draft.key === focusOtherKey,
                  onEnter: () => addOtherAfter(i),
                  onRemove:
                    editable && otherDrafts.length > 1
                      ? () =>
                          commitOther(
                            otherDrafts.filter((d) => d.key !== draft.key),
                            otherChecked,
                          )
                      : undefined,
                },
              )}
            </div>
          ))
        : [];
      const displayOptions = options.map((opt) => ({
        value: opt.option_id,
        label: labelFor(opt),
        badge: badgeFor(opt.option_id),
        content: inline && opt.option_id === otherOptionId ? otherFields[0] : undefined,
      }));

      const control =
        config.display_style === "buttons" ? (
          <ButtonGroup
            options={displayOptions}
            value={selected}
            onChange={toggle}
            locked={!editable}
            clickThrough={!interactive}
          />
        ) : (
          <CheckboxList
            options={displayOptions}
            value={selected}
            onChange={toggle}
            locked={!editable}
            size={19}
            fontSize="16px"
            gap="8px"
            rowHeight="36px"
            labelGap="16px"
          />
        );
      // Indented past the 19px box and 16px label gap to line up under the first field.
      return inline
        ? withOtherFields(control, otherFields.slice(1), 35)
        : withOtherFields(control, otherFields);
    }

    case "ranked_choice": {
      const options = liveOptions;
      const ranks = config.ranks ?? options.length;
      return (
        <RankedList
          options={options.map((opt) => ({
            value: opt.option_id,
            label: opt.label,
            badge: badgeFor(opt.option_id),
          }))}
          ranks={ranks}
          value={interactive ? ((value as Record<string, string> | undefined) ?? {}) : {}}
          onChange={(next) => editable && onChange?.(next)}
          allowDuplicates={!!config.allow_duplicates}
          locked={!editable}
          error={error}
        />
      );
    }

    default:
      // reserved lunch_* config bodies (date + category picker) — not wired up yet.
      return (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          Preview not available for &ldquo;{field.question_type}&rdquo; yet.
        </p>
      );
  }
}

// The TD-facing counterpart to QuestionBody — same question_type switch, but
// each branch renders that type's config editor instead of an answer widget.
// An add-on can replace the options editor for its own questions (see
// FieldExtension.OptionsEditor). Branching/display_style support is purely a
// question_type property (BRANCHING_TYPES/DISPLAY_STYLE_TYPES), whichever
// editor renders the rows.
function QuestionEditBody({
  field,
  onFieldChange,
  branchTargets,
  branchingEnabled,
  customValuesEnabled,
  errors = [],
  allowArchive = false,
  onOpenAddon,
}: {
  field: QuestionFieldData;
  onFieldChange: (updates: FieldUpdate) => void;
  branchTargets?: BranchTarget[];
  branchingEnabled?: boolean;
  customValuesEnabled?: boolean;
  errors?: string[];
  allowArchive?: boolean;
  onOpenAddon?: () => void;
}) {
  const extendable: ExtendableField = {
    field_key: field.field_key ?? "",
    question_type: field.question_type,
    config: field.config,
  };
  const extension = useFieldExtension(extendable);
  const AddonOptionsEditor = extension.OptionsEditor;
  const supportsBranching = BRANCHING_TYPES.includes(field.question_type);

  if (field.question_type === "acknowledgment") {
    // Gated on the current config too, not just the errors snapshot from the
    // last Save attempt — otherwise typing into the field wouldn't clear its
    // own error until the next Save/validate() call re-ran.
    const confirmError =
      errors.includes("Confirmation text is required.") && !field.config?.confirm_label?.trim()
        ? "Confirmation text is required."
        : undefined;
    return <AcknowledgmentBody field={field} onFieldChange={onFieldChange} error={confirmError} />;
  }

  // Archived options reach the editor now that there's something to do with
  // them — OptionsEditor lists them separately with a restore action. They're
  // still never shown to a respondent; that filtering lives in QuestionBody.
  // The submitted list is authoritative, so an archived option dropped here
  // would be deleted outright rather than merely hidden.
  const allOptions = (field.config?.options as EditableOption[] | undefined) ?? [];
  const liveOptions = allOptions.filter((option) => !option.is_archived);
  const setOptions = (options: EditableOption[]) =>
    onFieldChange({ config: { ...field.config, options } });

  if (OPTION_BEARING_TYPES.includes(field.question_type)) {
    return (
      <>
        {AddonOptionsEditor ? (
          <AddonOptionsEditor
            field={extendable}
            options={allOptions}
            onChange={setOptions}
            displayStyle={field.config?.display_style}
            branchTargets={supportsBranching && branchingEnabled ? branchTargets : undefined}
            errors={errors}
            allowArchive={allowArchive}
            onOpenAddon={onOpenAddon}
          />
        ) : (
          <OptionsEditor
            options={allOptions}
            onChange={setOptions}
            allowArchive={allowArchive}
            questionType={field.question_type}
            displayStyle={field.config?.display_style}
            branchTargets={supportsBranching && branchingEnabled ? branchTargets : undefined}
            syncValueWithLabel={!customValuesEnabled}
            errors={errors}
            allowOther={
              OTHER_TYPES.includes(field.question_type) && extension.allowsOther !== false
            }
          />
        )}
        {/* Ranks applies to ranked_choice whichever editor renders the rows —
            the rank mechanics are a property of the question type. An add-on
            can hide the duplicate-ranks toggle where duplicates can never be
            allowed (hidden rather than shown disabled). */}
        {field.question_type === "ranked_choice" &&
          (() => {
            const options = liveOptions;
            const ranks = field.config?.ranks ?? 1;
            // Same live-data gate as confirmError above — re-check against the
            // current option count rather than trusting the errors snapshot is
            // still accurate once ranks or the option list has since changed.
            const ranksError =
              errors.includes("Ranks can't exceed the number of options.") && ranks > options.length
                ? "Can't exceed the number of options."
                : undefined;
            return (
              <div
                style={{ marginTop: "12px", display: "flex", alignItems: "flex-end", gap: "20px" }}
              >
                <div style={{ width: "100px" }}>
                  <Input
                    font="sans"
                    label="Ranks"
                    type="number"
                    min={1}
                    value={String(ranks)}
                    onChange={(e) =>
                      onFieldChange({
                        config: {
                          ...field.config,
                          ranks: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                    error={ranksError}
                    size="sm"
                    fullWidth
                  />
                </div>
                {!extension.hideAllowDuplicates && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      paddingBottom: "9px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "13px",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Allow duplicate ranks
                    </span>
                    <Switch
                      checked={!!field.config?.allow_duplicates}
                      onChange={(checked) =>
                        onFieldChange({ config: { ...field.config, allow_duplicates: checked } })
                      }
                    />
                  </div>
                )}
              </div>
            );
          })()}
      </>
    );
  }

  return <QuestionBody field={field} interactive={false} />;
}

// Acknowledgment's edit body — the one piece of its config with no default
// on the backend (AcknowledgmentConfig.confirm_label has no fallback, unlike
// every other type-specific config key here), so it needs a real editor
// rather than silently defaulting at save time like ranks/allow_duplicates.
function AcknowledgmentBody({
  field,
  onFieldChange,
  error,
}: {
  field: QuestionFieldData;
  onFieldChange: (updates: FieldUpdate) => void;
  error?: string;
}) {
  return (
    <Input
      font="sans"
      label="Confirmation text"
      value={field.config?.confirm_label ?? ""}
      onChange={(e) =>
        onFieldChange({ config: { ...field.config, confirm_label: e.target.value } })
      }
      placeholder="I understand and agree to the above"
      error={error}
      size="sm"
      fullWidth
    />
  );
}
