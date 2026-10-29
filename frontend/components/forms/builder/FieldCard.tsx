"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { newOption } from "@/components/forms/builder/OptionsEditor";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dropdown } from "@/components/ui/Dropdown";
import { FormattedText } from "@/components/ui/FormattedText";
import { IconCopy, IconGripVertical, IconTrash } from "@/components/ui/Icons";
import { RichTextInput } from "@/components/ui/RichTextInput";
import { Switch } from "@/components/ui/Switch";
import type { FormQuestionType } from "@/lib/api";
import { backwardBranchTargetIds, branchTargetsFor } from "@/lib/forms/branching";
import { useFieldExtension, useFormBuilderAddon, useOptionLabel } from "@/lib/forms/builderAddon";
import { cleanOption, type EditableField } from "@/lib/forms/editableField";
import { effectiveFieldKey, isFieldKeyError } from "@/lib/forms/fieldKeys";
import {
  OPTION_BEARING_TYPES,
  OTHER_TYPES,
  QUESTION_TYPE_OPTIONS,
  sanitizeConfigForType,
} from "@/lib/forms/fieldTypes";
import { useCardHeight } from "@/lib/forms/useCardHeight";
import { issuesFor } from "@/lib/forms/useFormValidation";

// How long to keep waiting for the clicked input to exist. An add-on's options
// editor can show a loading state until its data lands, so the option row a
// click was aimed at isn't in the DOM at the moment the card expands.
const FOCUS_WAIT_MS = 4000;

// Which editor input a click on the collapsed preview was aimed at. Options
// are addressed by position, not option_id: unsaved options all carry a blank
// id, and preview and editor render the same list in the same order anyway.
export type FocusIntent = {
  target: "label" | "description" | `option:${number}`;
  /** Character offset the click landed on within the preview's text, so the
      caret opens where you pointed. null when the click missed the text. */
  offset: number | null;
} | null;

// Character offset of a viewport point, counted from the start of `within`'s
// text when given (formatted text spans several text nodes), else within its
// own text node. Chrome/Firefox expose caretPositionFromPoint; WebKit only
// has the older caretRangeFromPoint.
function caretOffsetFromPoint(x: number, y: number, within?: HTMLElement): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  const range = pos ? null : document.caretRangeFromPoint?.(x, y);
  const node = pos ? pos.offsetNode : range?.startContainer;
  const offset = pos ? pos.offset : range?.startOffset;
  // Outside a text node the "offset" is a child index, which would be a
  // meaningless caret position — better to fall back to the end of the value.
  if (!node || offset === undefined || node.nodeType !== Node.TEXT_NODE) return null;
  if (!within) return offset;
  if (!within.contains(node)) return null;
  const before = document.createRange();
  before.setStart(within, 0);
  before.setEnd(node, offset);
  return before.toString().length;
}

// The rich-text editor counterpart of setSelectionRange: ProseMirror follows
// the DOM selection, so collapsing it at a text offset moves the editor's caret.
function placeCaretInEditable(root: HTMLElement, offset: number | null) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset ?? Number.POSITIVE_INFINITY;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.length) {
      window.getSelection()?.collapse(node, remaining);
      return;
    }
    remaining -= node.length;
    last = node;
  }
  if (last) window.getSelection()?.collapse(last, last.length);
}

// An option row leads with its bullet — a real <input type="checkbox"/"radio">
// rendered as the respondent-facing preview — so "the first input in the row"
// is not the label field, and isn't even selection-capable.
const TEXT_FIELD = 'textarea, input[type="text"], input:not([type])';

function resolveTarget(root: HTMLElement, target: NonNullable<FocusIntent>["target"]) {
  if (target.startsWith("option:")) {
    const row = root.querySelectorAll<HTMLElement>("[data-option-value]")[Number(target.slice(7))];
    return row?.querySelector<HTMLInputElement | HTMLTextAreaElement>(TEXT_FIELD) ?? null;
  }
  // A description that's empty isn't rendered on the collapsed card at all, so
  // its intent can only arrive when the editor has the field — but fall back
  // rather than no-op if that ever stops holding.
  return (
    root.querySelector<HTMLElement>(`[data-focus="${target}"]`) ??
    root.querySelector<HTMLElement>('[data-focus="label"]')
  );
}

// Resolves an intent against an expanded card's DOM and drops the caret in.
// Matched by data attributes rather than refs since the targets live at
// different depths across three components (here, QuestionRenderer,
// OptionsEditor) and most of them don't exist until the card is expanded.
// Returns a canceller: the retry below outlives the click that started it.
function applyFocusIntent(root: HTMLElement, intent: FocusIntent) {
  if (!intent) return () => {};
  let frame = 0;
  const deadline = Date.now() + FOCUS_WAIT_MS;

  const attempt = () => {
    const active = document.activeElement;
    // The user got there first while we were waiting on a fetch — stealing
    // focus out from under them mid-keystroke is worse than not landing it.
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    ) {
      return;
    }

    const target = resolveTarget(root, intent.target);
    if (!target) {
      if (Date.now() < deadline) frame = requestAnimationFrame(attempt);
      return;
    }
    target.focus();
    if (target.isContentEditable) {
      placeCaretInEditable(target, intent.offset);
      return;
    }
    // selectionStart is null on input types that don't support selection
    // (checkbox, radio, ...) — reading it is the sanctioned way to ask,
    // and calling setSelectionRange on one throws InvalidStateError.
    if (
      (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
      target.selectionStart !== null
    ) {
      // Where you clicked, clamped to what the editor actually holds — an
      // entity-backed option's preview text ("Crime Busters B, 9:00–11:00")
      // is longer than the label the editor is editing.
      const caret = Math.min(intent.offset ?? target.value.length, target.value.length);
      target.setSelectionRange(caret, caret);
    }
  };

  attempt();
  return () => cancelAnimationFrame(frame);
}

// One card in the field list — collapsed, it's a read-only preview of the
// real question (QuestionRenderer's view mode); expanded, it's the editor:
// label/type chrome here (the field key and any add-on popover live in
// FieldToolbar, not inline), plus whatever body
// QuestionRenderer's edit mode renders for this question_type (options
// list, ranks, confirm text, entity picker, ...). Splitting it that way
// keeps the type-by-type switch in one place (QuestionRenderer) instead of
// duplicated between a respondent-facing renderer and a TD-facing editor.
export function FieldCard({
  field,
  expanded,
  onExpand,
  focusIntent,
  focusNonce,
  onFieldChange,
  onDuplicate,
  onDelete,
  allFields,
  errors,
  allowArchive = false,
  onOpenAddon,
  locked = false,
}: {
  field: EditableField;
  expanded: boolean;
  /** Carries which part of the collapsed preview was clicked, so the card can
      open with the caret already in the editor input that renders it. */
  onExpand: (intent: FocusIntent) => void;
  focusIntent: FocusIntent;
  /** Bumped per expand — the effect that consumes focusIntent keys off this
      so it fires once per click, not on every re-render while expanded. */
  focusNonce: number;
  onFieldChange: (updates: Partial<EditableField>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  allFields: EditableField[];
  errors: string[];
  /** Opens this field's add-on popover — see AddonOptionsEditorProps.onOpenAddon. */
  onOpenAddon?: () => void;
  /** Passed through to the options editor — see QuestionRenderer. */
  allowArchive?: boolean;
  /** Archived tournament or form — stays a read-only preview: no expanding, no dragging. */
  locked?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const addon = useFormBuilderAddon();
  const extension = useFieldExtension(field);
  const optionLabel = useOptionLabel(field);
  // Key errors and the add-on's own surface exclusively through FieldToolbar's
  // popovers (danger-colored trigger + inline message) — the card itself
  // doesn't show the key, so it shouldn't double-report the same problem in
  // its own border/error list either.
  const isToolbarError = (e: string) => isFieldKeyError(e) || addon.ownsIssue(e);
  const nonKeyErrors = errors.filter((e) => !isToolbarError(e));
  // Re-run just this field's checks against its live, currently-being-edited
  // data — but only once the last validate() pass actually found something
  // here (so a never-touched field doesn't start flashing errors as soon as
  // you glance at it). This is what lets the card's danger border, and every
  // error message routed off of it below, disappear the moment the underlying
  // problem is actually fixed, rather than waiting on the next Save.
  const liveIssues = issuesFor(field, allFields, addon);
  const liveNonKeyErrors =
    nonKeyErrors.length > 0 ? liveIssues.filter((e) => !isToolbarError(e)) : [];
  // Routed straight onto the label input's own error prop below, rather
  // than a shared list — the rest of liveNonKeyErrors (options/confirm text/
  // ranks) get the same per-input treatment further down, inside
  // QuestionRenderer's edit body.
  const labelError = liveNonKeyErrors.includes("Question text is required.")
    ? "Question text is required."
    : undefined;
  const bodyErrors = liveNonKeyErrors.filter((e) => e !== "Question text is required.");
  // Toolbar errors themselves still surface only through FieldToolbar's
  // popovers (danger-colored trigger + inline message) — this doesn't
  // duplicate that message here, it just decides whether the card border
  // should flag that *something* in the toolbar needs attention. Same
  // gate-then-recheck pattern as liveNonKeyErrors above: only bothers once
  // the last validate() pass actually flagged a toolbar problem on this
  // field, then re-derives it from live data so fixing it via either popover
  // clears the border immediately.
  const hadToolbarError = errors.some(isToolbarError);
  const addonIssueOpen = liveIssues.some(addon.ownsIssue);
  const effKey = effectiveFieldKey(field);
  // Only a collision within this form; other forms may share the key.
  const duplicateKey =
    !!effKey &&
    allFields.some((f) => f.clientKey !== field.clientKey && effectiveFieldKey(f) === effKey);
  const hasToolbarCardError = hadToolbarError && (addonIssueOpen || duplicateKey);
  // Flagged without waiting for Save, so the card turns red as the reorder
  // that broke the branch lands.
  const hasBackwardBranch = backwardBranchTargetIds(field, allFields).size > 0;
  const hasCardError = liveNonKeyErrors.length > 0 || hasToolbarCardError || hasBackwardBranch;
  const branchTargets = branchTargetsFor(field, allFields);

  // Field-level reordering — separate DndContext from OptionsEditor's own
  // (scoped to a single field's option rows), so dragging a card doesn't
  // interfere with dragging an option within it.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: field.clientKey,
    disabled: locked,
  });
  // Translate, not Transform: dnd-kit's transforms carry scaleX/scaleY (the
  // ratio of another card's rect to this one's), so CSS.Transform would
  // squish/stretch cards to match whatever they pass over.
  // While dragging, the visible card is FieldList's DragOverlay copy and this
  // node stays mounted-but-invisible as the drop slot. It renders the same
  // compressed preview the overlay does (see the isDragging branch below)
  // rather than the full card: a tall question left a slot taller than the
  // viewport, so you couldn't see the gap you were aiming at. FieldList's
  // MeasuringStrategy.Always keeps dnd-kit's rects honest as that collapses.
  const sortableStyle = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };
  // The grip lives inside the collapsed Card, which has its own onClick to
  // expand — grabbing the grip shouldn't also trigger that.
  const gripProps = {
    ...attributes,
    ...listeners,
    onClick: (e: ReactMouseEvent) => e.stopPropagation(),
  };

  const rootRef = useRef<HTMLDivElement>(null);
  // Skipped mid-drag: the card swaps to the compressed placeholder then back,
  // and animating that would fight dnd-kit's continuous rect measuring.
  useCardHeight(rootRef, expanded, isDragging);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per expand; focusIntent only rides along
  useEffect(() => {
    if (!focusNonce || !rootRef.current) return;
    return applyFocusIntent(rootRef.current, focusIntent);
    // Once per expand — focusNonce is the edge, focusIntent just rides along.
  }, [focusNonce]);

  // Reads the click's position in the preview off the data attributes the
  // preview renders (QuestionRenderer's header, RadioList/CheckboxList's
  // rows), so clicking a question, its description, or one specific option
  // opens the card with that input focused.
  function handleCollapsedClick(e: ReactMouseEvent) {
    const el = e.target instanceof HTMLElement ? e.target : null;
    // A link in the preview should open the card like any other text, not navigate.
    if (el?.closest("a")) e.preventDefault();
    const optionRow = el?.closest<HTMLElement>("[data-option-value]");
    if (optionRow) {
      const rows = [
        ...(rootRef.current?.querySelectorAll<HTMLElement>("[data-option-value]") ?? []),
      ];
      const offset = caretOffsetFromPoint(e.clientX, e.clientY);
      onExpand({ target: `option:${rows.indexOf(optionRow)}`, offset });
      return;
    }
    const focusEl = el?.closest<HTMLElement>("[data-focus]");
    const focus = focusEl?.dataset.focus;
    if (focusEl && (focus === "label" || focus === "description")) {
      onExpand({ target: focus, offset: caretOffsetFromPoint(e.clientX, e.clientY, focusEl) });
    } else {
      onExpand(null);
    }
  }

  // Every question_type switch drops whatever config keys belonged to the
  // *previous* type — e.g. short_text's max_length has nowhere to go on
  // multi_select_checkbox, and the backend's extra="forbid" config schemas
  // reject it outright rather than ignoring it. Landing on an option-bearing
  // type with no options yet (a fresh field, one switched over from a
  // non-option type, or a preset whose kind was just picked/changed) also
  // gets one starter row so there's always something ready to edit rather
  // than an empty list the TD has to click "Add option" to even start on —
  // an add-on can seed its own shape (an empty id array to fill in via a
  // picker), everything else gets the plain freeform one.
  function handleQuestionTypeChange(questionType: FormQuestionType) {
    const config = sanitizeConfigForType(field.config, questionType);
    // Per-option keys too — sanitizeConfigForType only knows config-level
    // ones, and a radio's branch keys on a checkbox option 422 the save.
    if (config.options)
      config.options = config.options
        .filter((option) => !option.is_other || OTHER_TYPES.includes(questionType))
        .map((option) => cleanOption(option, questionType));
    const needsStarterOption =
      OPTION_BEARING_TYPES.includes(questionType) && !config.options?.length;
    const starterOption = (extension.newOption ?? newOption)();
    onFieldChange({
      question_type: questionType,
      config: needsStarterOption ? { ...config, options: [starterOption] } : config,
    });
  }

  return (
    // Outer box stays untransformed so the shared toolbar can measure this
    // card's resting offsetTop/offsetHeight — sortable transform/opacity apply
    // one level in rather than on this node directly.
    <div ref={rootRef} data-field-card={field.clientKey} style={{ position: "relative" }}>
      <div ref={setNodeRef} style={sortableStyle}>
        {isDragging ? (
          <FieldCardDragPreview field={field} />
        ) : expanded ? (
          <Card
            radius="lg"
            variant={hasCardError ? "danger" : "normal"}
            borderColor={hasCardError ? undefined : "var(--color-border-strong)"}
            style={{ padding: "28px 24px 20px", position: "relative" }}
          >
            <div
              {...gripProps}
              style={{
                position: "absolute",
                top: "6px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                color: "var(--color-text-tertiary)",
                cursor: "grab",
                touchAction: "none",
              }}
            >
              <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                marginBottom: field.showDescription ? "10px" : "16px",
              }}
            >
              <RichTextInput
                data-focus="label"
                variant="inline"
                value={field.label}
                onChange={(label) => onFieldChange({ label })}
                placeholder="Question"
                fullWidth
                error={labelError}
              />
              <Dropdown
                value={field.question_type}
                onChange={(v) => handleQuestionTypeChange(v as FormQuestionType)}
                options={
                  extension.allowedQuestionTypes
                    ? QUESTION_TYPE_OPTIONS.filter((o) =>
                        extension.allowedQuestionTypes?.includes(o.value),
                      )
                    : QUESTION_TYPE_OPTIONS
                }
                width={220}
              />
            </div>
            {field.showDescription && (
              <div style={{ marginBottom: "16px" }}>
                <RichTextInput
                  data-focus="description"
                  variant="rich"
                  value={field.description ?? ""}
                  onChange={(description) => onFieldChange({ description })}
                  placeholder="Description"
                  size="sm"
                  fullWidth
                />
              </div>
            )}
            <QuestionRenderer
              field={field}
              mode="edit"
              showHeader={false}
              onFieldChange={onFieldChange}
              branchTargets={branchTargets}
              branchingEnabled={field.branchingEnabled}
              customValuesEnabled={field.customValuesEnabled}
              errors={bodyErrors}
              allowArchive={allowArchive}
              onOpenAddon={onOpenAddon}
            />

            <div
              style={{ height: "1px", background: "var(--color-border)", margin: "18px 0 12px" }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "13px",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Required
                </span>
                <Switch
                  checked={!!field.config?.required}
                  onChange={(checked) =>
                    onFieldChange({ config: { ...field.config, required: checked } })
                  }
                  locked={!!extension.requiredLocked}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="Duplicate question"
                  onClick={onDuplicate}
                >
                  <IconCopy size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  title="Delete question"
                  onClick={onDelete}
                  style={{ color: "var(--color-danger)" }}
                >
                  <IconTrash size={14} />
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card
            radius="lg"
            variant={hasCardError ? "danger" : "normal"}
            style={{
              padding: "20px 24px",
              cursor: locked ? "default" : "pointer",
              position: "relative",
            }}
            onClick={locked ? undefined : handleCollapsedClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div
              {...gripProps}
              style={{
                position: "absolute",
                top: "6px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                color: "var(--color-text-tertiary)",
                cursor: "grab",
                touchAction: "none",
                opacity: hovered && !locked ? 1 : 0,
              }}
            >
              <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
            </div>
            {/* field-preview turns the pieces that map to an editor input
                (see FocusIntent) into an I-beam, so the preview reads as
                editable text rather than one big button. Scoped by class
                because the targets are rendered by shared components that
                the respondent-facing form uses too. */}
            <div className="field-preview">
              <QuestionRenderer field={field} interactive={false} optionLabel={optionLabel} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// What actually follows the cursor mid-drag (rendered into FieldList's
// DragOverlay). Deliberately not either real card branch: flying a full
// editor — or even the collapsed card's whole options preview — around the
// list makes it hard to see where you're dropping, so a dragged card
// compresses to one line of question text regardless of its prior state.
export function FieldCardDragPreview({ field }: { field: EditableField }) {
  return (
    <Card
      radius="lg"
      borderColor="var(--color-border-strong)"
      style={{
        padding: "20px 20px 12px",
        cursor: "grabbing",
        boxShadow: "var(--shadow-md)",
        position: "relative",
      }}
    >
      {/* Same top-center placement as the expanded/collapsed card's own grip
          (FieldCard below) — keeps the drag handle's position consistent
          across the whole drag, not just while dragging. */}
      <div
        style={{
          position: "absolute",
          top: "6px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          color: "var(--color-text-tertiary)",
        }}
      >
        <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
      </div>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-sans)",
          fontSize: "15px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <FormattedText
          markdown={field.label.trim().replace(/\n/g, " ") || "Untitled question"}
          variant="inline"
        />
      </span>
    </Card>
  );
}
