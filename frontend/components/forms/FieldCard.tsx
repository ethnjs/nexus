"use client";

import { useState, MouseEvent as ReactMouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FormQuestionType } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { Dropdown } from "@/components/ui/Dropdown";
import { Popover } from "@/components/ui/Popover";
import { Toggle } from "@/components/ui/Toggle";
import {
  IconGripVertical, IconCopy, IconTrash, IconDotsVertical,
} from "@/components/ui/Icons";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { BranchTarget, newEntityOption, newOption } from "@/components/forms/OptionsEditor";
import { EditableField } from "@/lib/forms/editableField";
import { activePresetKind, isEntityBackedPreset, PRESETS, isFieldKeyError, isPresetError } from "@/lib/forms/fieldKeyPresets";
import { QUESTION_TYPE_OPTIONS, OPTION_BEARING_TYPES, BRANCHING_TYPES, sanitizeConfigForType } from "@/lib/forms/fieldTypes";
import { issuesFor } from "@/lib/forms/useFormValidation";

// One card in the field list — collapsed, it's a read-only preview of the
// real question (QuestionRenderer's view mode); expanded, it's the editor:
// label/type chrome here (field key + reserved presets live in FieldToolbar
// now, not inline — see FieldKeyPopover/PresetPopover), plus whatever body
// QuestionRenderer's edit mode renders for this question_type (options
// list, ranks, confirm text, entity picker, ...). Splitting it that way
// keeps the type-by-type switch in one place (QuestionRenderer) instead of
// duplicated between a respondent-facing renderer and a TD-facing editor.
export function FieldCard({
  field, expanded, onExpand, onFieldChange, onDuplicate, onDelete, tournamentId, allFields, errors,
}: {
  field: EditableField;
  expanded: boolean;
  onExpand: () => void;
  onFieldChange: (updates: Partial<EditableField>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  tournamentId: number | null;
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
  // Purely a question_type property — an entity-backed preset's options are
  // still real, addressable rows a TD can branch from just like a plain
  // question's (see QuestionRenderer's identical calc).
  const supportsBranching = BRANCHING_TYPES.includes(field.question_type);
  const [branchingEnabled, setBranchingEnabled] = useState(() =>
    (field.config?.options ?? []).some((o) => o.next_field_id != null || o.action != null)
  );
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
  // While dragging, the visible card is FieldList's DragOverlay copy — this
  // node stays mounted at full size but invisible, so the gap it leaves is
  // the real drop slot and dnd-kit's drag-start rect measurements stay valid.
  const sortableStyle = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0 : 1 };
  // The grip lives inside the collapsed Card, which has its own onClick to
  // expand — grabbing the grip shouldn't also trigger that.
  const gripProps = { ...attributes, ...listeners, onClick: (e: ReactMouseEvent) => e.stopPropagation() };

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
    <div data-field-card={field.clientKey} style={{ position: "relative" }}>
      <div ref={setNodeRef} style={sortableStyle}>
        {expanded ? (
          <Card radius="lg" borderColor={liveNonKeyErrors.length > 0 ? "var(--color-danger)" : "var(--color-border-strong)"} style={{ padding: "28px 24px 20px", position: "relative" }}>
            <div {...gripProps} style={{
              position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
              display: "flex", color: "var(--color-text-tertiary)", cursor: "grab", touchAction: "none",
            }}>
              <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: field.showDescription ? "10px" : "16px" }}>
              <Textarea
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
              tournamentId={tournamentId}
              branchTargets={branchTargets}
              branchingEnabled={branchingEnabled}
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
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <Button type="button" variant="ghost" size="sm" iconOnly title="Duplicate question" onClick={onDuplicate}>
                  <IconCopy size={14} />
                </Button>
                <Button type="button" variant="ghost" size="sm" iconOnly title="Delete question" onClick={onDelete} style={{ color: "var(--color-danger)" }}>
                  <IconTrash size={14} />
                </Button>
                {supportsBranching && (
                  <>
                    <div style={{ width: "1px", height: "20px", background: "var(--color-border)", margin: "0 4px" }} />
                    <Popover
                      trigger={
                        <Button type="button" variant="ghost" size="sm" iconOnly title="More options">
                          <IconDotsVertical size={15} />
                        </Button>
                      }
                      items={[{ key: "branching", label: "Branching" }]}
                      getKey={(item) => item.key}
                      checklist
                      isSelected={() => branchingEnabled}
                      onSelect={() => setBranchingEnabled((v) => !v)}
                      renderLabel={(item) => item.label}
                      width={160}
                    />
                  </>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card
            radius="lg"
            borderColor={liveNonKeyErrors.length > 0 ? "var(--color-danger)" : undefined}
            style={{ padding: "20px 24px", cursor: "pointer", position: "relative" }}
            onClick={onExpand}
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
            <QuestionRenderer field={field} interactive={false} />
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
