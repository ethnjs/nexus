"use client";

import { useEffect, useRef, useState, MouseEvent as ReactMouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FormQuestionType, Tournament, TournamentShift } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { Dropdown } from "@/components/ui/Dropdown";
import { Toggle } from "@/components/ui/Toggle";
import {
  IconGripVertical, IconCopy, IconTrash,
} from "@/components/ui/Icons";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { useCardHeight } from "@/lib/forms/useCardHeight";
import { BranchTarget, newEntityOption, newOption } from "@/components/forms/OptionsEditor";
import { EditableField } from "@/lib/forms/editableField";
import { activePresetKind, effectiveFieldKey, isEntityBackedPreset, PRESETS, isFieldKeyError, isPresetError } from "@/lib/forms/fieldKeyPresets";
import { QUESTION_TYPE_OPTIONS, OPTION_BEARING_TYPES, sanitizeConfigForType } from "@/lib/forms/fieldTypes";
import { issuesFor } from "@/lib/forms/useFormValidation";

// How long to keep waiting for the clicked input to exist. The entity-backed
// editors (availability/event_preference) render "Loading shifts…" until their
// fetch lands, so the option row a click was aimed at isn't in the DOM at the
// moment the card expands.
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

// Character offset of a viewport point within its own text node. Chrome/Firefox
// expose caretPositionFromPoint; WebKit only has the older caretRangeFromPoint.
function caretOffsetFromPoint(x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return pos.offsetNode.nodeType === Node.TEXT_NODE ? pos.offset : null;
  const range = document.caretRangeFromPoint?.(x, y);
  // Outside a text node the "offset" is a child index, which would be a
  // meaningless caret position — better to fall back to the end of the value.
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  return range.startOffset;
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
  return root.querySelector<HTMLElement>(`[data-focus="${target}"]`)
    ?? root.querySelector<HTMLElement>('[data-focus="label"]');
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
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

    const target = resolveTarget(root, intent.target);
    if (!target) {
      if (Date.now() < deadline) frame = requestAnimationFrame(attempt);
      return;
    }
    target.focus();
    // selectionStart is null on input types that don't support selection
    // (checkbox, radio, ...) — reading it is the sanctioned way to ask,
    // and calling setSelectionRange on one throws InvalidStateError.
    if ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
      && target.selectionStart !== null) {
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
// label/type chrome here (field key + reserved presets live in FieldToolbar
// now, not inline — see FieldKeyPopover/PresetPopover), plus whatever body
// QuestionRenderer's edit mode renders for this question_type (options
// list, ranks, confirm text, entity picker, ...). Splitting it that way
// keeps the type-by-type switch in one place (QuestionRenderer) instead of
// duplicated between a respondent-facing renderer and a TD-facing editor.
export function FieldCard({
  field, expanded, onExpand, focusIntent, focusNonce, onFieldChange, onDuplicate, onDelete, tournament, shifts, allFields, errors,
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
  /** null hides the availability/event_preference entity-backed editor
      (falls through to the plain preview instead) — a chapter-owned form has
      no tournament to source shifts/events from. Also carries is_multi_day,
      which decides how EntityOptionsEditor's shift chips/picker display. */
  tournament: Tournament | null;
  /** Collapsed-card preview only — lets an availability option's time range
      resolve client-side (its `value` is still raw shift ids, not GET's
      resolved shape) without every card fetching its own copy. null while
      still loading, same as tournament. */
  shifts: TournamentShift[] | null;
  allFields: EditableField[];
  errors: string[];
}) {
  const [hovered, setHovered] = useState(false);
  const presetKind = activePresetKind(field.field_key);
  // Key/preset errors surface exclusively through FieldToolbar's popovers
  // now (danger-colored trigger + inline message) — the card itself no
  // longer shows the key or flags it, so it shouldn't double-report the
  // same problem in its own border/error list either.
  const nonKeyErrors = errors.filter((e) => !isFieldKeyError(e) && !isPresetError(e));
  // Re-run just this field's structural checks against its live, currently-
  // being-edited data — but only once the last validate() pass actually
  // found something here (so a never-touched field doesn't start flashing
  // errors as soon as you glance at it). This is what lets the card's danger
  // border, and every error message routed off of it below, disappear the
  // moment the underlying problem is actually fixed, rather than waiting on
  // the next Save/validate() call.
  const liveNonKeyErrors = nonKeyErrors.length > 0
    ? issuesFor(field).filter((e) => !isFieldKeyError(e) && !isPresetError(e))
    : [];
  // Routed straight onto the label Textarea's own error prop below, rather
  // than a shared list — the rest of liveNonKeyErrors (options/confirm text/
  // ranks) get the same per-input treatment further down, inside
  // QuestionRenderer's edit body.
  const labelError = liveNonKeyErrors.includes('Question text is required.') ? 'Question text is required.' : undefined;
  const bodyErrors = liveNonKeyErrors.filter((e) => e !== 'Question text is required.');
  // Key/preset errors themselves still surface only through FieldToolbar's
  // popovers (danger-colored trigger + inline message) — this doesn't
  // duplicate that message here, it just decides whether the card border
  // should flag that *something* in the toolbar needs attention. Same
  // gate-then-recheck pattern as liveNonKeyErrors above: only bothers once
  // the last validate() pass actually flagged a key/preset problem on this
  // field, then re-derives it from live data so fixing it via either popover
  // clears the border immediately.
  const hadKeyOrPresetError = errors.some((e) => isFieldKeyError(e) || isPresetError(e));
  const presetIncomplete = !!presetKind && field.field_key.endsWith('_');
  const effKey = effectiveFieldKey(field);
  const duplicateKey = !!effKey && allFields.some((f) => f.clientKey !== field.clientKey && effectiveFieldKey(f) === effKey);
  const hasKeyOrPresetError = hadKeyOrPresetError && (presetIncomplete || duplicateKey);
  const hasCardError = liveNonKeyErrors.length > 0 || hasKeyOrPresetError;
  const branchTargets: BranchTarget[] = allFields
    .filter((f) => f.clientKey !== field.clientKey && f.label.trim())
    .map((f) => ({ id: f.id, label: f.label.trim() }));

  // Field-level reordering — separate DndContext from OptionsEditor's own
  // (scoped to a single field's option rows), so dragging a card doesn't
  // interfere with dragging an option within it.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: field.clientKey });
  // Translate, not Transform: dnd-kit's transforms carry scaleX/scaleY (the
  // ratio of another card's rect to this one's), so CSS.Transform would
  // squish/stretch cards to match whatever they pass over.
  // While dragging, the visible card is FieldList's DragOverlay copy and this
  // node stays mounted-but-invisible as the drop slot. It renders the same
  // compressed preview the overlay does (see the isDragging branch below)
  // rather than the full card: a tall question left a slot taller than the
  // viewport, so you couldn't see the gap you were aiming at. FieldList's
  // MeasuringStrategy.Always keeps dnd-kit's rects honest as that collapses.
  const sortableStyle = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0 : 1 };
  // The grip lives inside the collapsed Card, which has its own onClick to
  // expand — grabbing the grip shouldn't also trigger that.
  const gripProps = { ...attributes, ...listeners, onClick: (e: ReactMouseEvent) => e.stopPropagation() };

  const rootRef = useRef<HTMLDivElement>(null);
  // Skipped mid-drag: the card swaps to the compressed placeholder then back,
  // and animating that would fight dnd-kit's continuous rect measuring.
  useCardHeight(rootRef, expanded, isDragging);

  useEffect(() => {
    if (!focusNonce || !rootRef.current) return;
    return applyFocusIntent(rootRef.current, focusIntent);
    // Once per expand — focusNonce is the edge, focusIntent just rides along.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Reads the click's position in the preview off the data attributes the
  // preview renders (QuestionRenderer's header, RadioList/CheckboxList's
  // rows), so clicking a question, its description, or one specific option
  // opens the card with that input focused.
  function handleCollapsedClick(e: ReactMouseEvent) {
    const el = e.target instanceof HTMLElement ? e.target : null;
    const offset = caretOffsetFromPoint(e.clientX, e.clientY);
    const optionRow = el?.closest<HTMLElement>("[data-option-value]");
    if (optionRow) {
      const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-option-value]") ?? [])];
      onExpand({ target: `option:${rows.indexOf(optionRow)}`, offset });
      return;
    }
    const focus = el?.closest<HTMLElement>("[data-focus]")?.dataset.focus;
    onExpand(focus === "label" || focus === "description" ? { target: focus, offset } : null);
  }

  // Every question_type switch drops whatever config keys belonged to the
  // *previous* type — e.g. short_text's max_length has nowhere to go on
  // multi_select_checkbox, and the backend's extra="forbid" config schemas
  // reject it outright rather than ignoring it. Landing on an option-bearing
  // type with no options yet (a fresh field, one switched over from a
  // non-option type, or a preset whose kind was just picked/changed) also
  // gets one starter row so there's always something ready to edit rather
  // than an empty list the TD has to click "Add option" to even start on —
  // entity-backed presets get the entity-shaped starter (an empty id array
  // to fill in via the picker), everything else gets the plain freeform one.
  function handleQuestionTypeChange(questionType: FormQuestionType) {
    const config = sanitizeConfigForType(field.config, questionType);
    const needsStarterOption = OPTION_BEARING_TYPES.includes(questionType) && !config.options?.length;
    const starterOption = isEntityBackedPreset(presetKind) ? newEntityOption() : newOption();
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
            <div {...gripProps} style={{
              position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
              display: "flex", color: "var(--color-text-tertiary)", cursor: "grab", touchAction: "none",
            }}>
              <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: field.showDescription ? "10px" : "16px" }}>
              <Textarea
                data-focus="label"
                value={field.label}
                onChange={(e) => onFieldChange({ label: e.target.value })}
                placeholder="Question"
                rows={1}
                autoGrow
                fullWidth
                error={labelError}
                style={{ padding: "7px 16px", lineHeight: "20px", borderRadius: "var(--radius-md)" }}
              />
              <Dropdown
                value={field.question_type}
                onChange={(v) => handleQuestionTypeChange(v as FormQuestionType)}
                options={presetKind ? QUESTION_TYPE_OPTIONS.filter((o) => PRESETS[presetKind].allowedQuestionTypes.includes(o.value)) : QUESTION_TYPE_OPTIONS}
                width={220}
              />
            </div>
            {field.showDescription && (
              <div style={{ marginBottom: "16px" }}>
                <Textarea
                  data-focus="description"
                  value={field.description ?? ""}
                  onChange={(e) => onFieldChange({ description: e.target.value })}
                  placeholder="Description"
                  rows={1}
                  autoGrow
                  size="sm"
                  fullWidth
                  style={{ padding: "5px 10px", lineHeight: "16px", borderRadius: "var(--radius-md)" }}
                />
              </div>
            )}
            <QuestionRenderer
              field={field}
              mode="edit"
              showHeader={false}
              onFieldChange={onFieldChange}
              tournament={tournament}
              branchTargets={branchTargets}
              branchingEnabled={field.branchingEnabled}
              customValuesEnabled={field.customValuesEnabled}
              errors={bodyErrors}
            />

            <div style={{ height: "1px", background: "var(--color-border)", margin: "18px 0 12px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                  Required
                </span>
                <Toggle
                  checked={!!field.config?.required}
                  onChange={(checked) => onFieldChange({ config: { ...field.config, required: checked } })}
                  locked={presetKind === "track_status"}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <Button type="button" variant="ghost" size="sm" iconOnly title="Duplicate question" onClick={onDuplicate}>
                  <IconCopy size={14} />
                </Button>
                <Button type="button" variant="ghost" size="sm" iconOnly title="Delete question" onClick={onDelete} style={{ color: "var(--color-danger)" }}>
                  <IconTrash size={14} />
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card
            radius="lg"
            variant={hasCardError ? "danger" : "normal"}
            style={{ padding: "20px 24px", cursor: "pointer", position: "relative" }}
            onClick={handleCollapsedClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div {...gripProps} style={{
              position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
              display: "flex", color: "var(--color-text-tertiary)", cursor: "grab", touchAction: "none",
              opacity: hovered ? 1 : 0,
            }}>
              <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
            </div>
            {/* field-preview turns the pieces that map to an editor input
                (see FocusIntent) into an I-beam, so the preview reads as
                editable text rather than one big button. Scoped by class
                because the targets are rendered by shared components that
                the respondent-facing form uses too. */}
            <div className="field-preview">
              <QuestionRenderer field={field} interactive={false} shifts={shifts} />
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
        padding: "20px 20px 12px", cursor: "grabbing", boxShadow: "var(--shadow-md)", position: "relative",
      }}
    >
      {/* Same top-center placement as the expanded/collapsed card's own grip
          (FieldCard below) — keeps the drag handle's position consistent
          across the whole drag, not just while dragging. */}
      <div style={{
        position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
        display: "flex", color: "var(--color-text-tertiary)",
      }}>
        <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
      </div>
      <span style={{
        display: "block",
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 600,
        color: "var(--color-text-primary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {field.label.trim() || "Untitled question"}
      </span>
    </Card>
  );
}
