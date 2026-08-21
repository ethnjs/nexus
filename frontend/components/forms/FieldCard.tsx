"use client";

import { useState, MouseEvent as ReactMouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FormQuestionType } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Combobox } from "@/components/ui/Combobox";
import { Tooltip } from "@/components/ui/Tooltip";
import { Popover } from "@/components/ui/Popover";
import { Toggle } from "@/components/ui/Toggle";
import {
  IconGripVertical, IconInfo, IconCopy, IconTrash, IconDotsVertical,
} from "@/components/ui/Icons";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { BranchTarget, newOption } from "@/components/forms/OptionsEditor";
import { EditableField } from "@/lib/forms/editableField";
import {
  FieldKeyComboOption, UsedFieldKeyOption, FIELD_KEY_PRESETS, activePreset, fieldToComboboxValue,
} from "@/lib/forms/fieldKeyPresets";
import { QUESTION_TYPE_OPTIONS, OPTION_BEARING_TYPES, BRANCHING_TYPES, sanitizeConfigForType } from "@/lib/forms/fieldTypes";

// One card in the field list — collapsed, it's a read-only preview of the
// real question (QuestionRenderer's view mode); expanded, it's the editor:
// label/type/field_key chrome here, plus whatever body QuestionRenderer's
// edit mode renders for this question_type (options list, ranks, confirm
// text, entity picker, ...). Splitting it that way keeps the type-by-type
// switch in one place (QuestionRenderer) instead of duplicated between a
// respondent-facing renderer and a TD-facing editor.
export function FieldCard({
  field, expanded, onExpand, onFieldChange, onDuplicate, onDelete, tournamentId, usedFieldKeys, allFields, errors,
}: {
  field: EditableField;
  expanded: boolean;
  onExpand: () => void;
  onFieldChange: (updates: Partial<EditableField>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  tournamentId: number | null;
  usedFieldKeys: string[];
  allFields: EditableField[];
  errors: string[];
}) {
  const [hovered, setHovered] = useState(false);
  const preset = activePreset(field.field_key);
  const supportsBranching = !preset && BRANCHING_TYPES.includes(field.question_type);
  const [branchingEnabled, setBranchingEnabled] = useState(() =>
    (field.config?.options ?? []).some((o) => o.next_field_id != null || o.action != null)
  );
  const branchTargets: BranchTarget[] = allFields
    .filter((f) => f.clientKey !== field.clientKey && f.label.trim())
    .map((f) => ({ id: f.id, label: f.label.trim() }));

  // Reserved key names are already represented by FIELD_KEY_PRESETS, and a
  // field editing its own already-saved key shouldn't see that key flagged
  // as "taken" by itself.
  const comboOptions: FieldKeyComboOption[] = [
    ...FIELD_KEY_PRESETS,
    ...usedFieldKeys
      .filter((k) => k !== field.field_key && !FIELD_KEY_PRESETS.some((p) => p.field_key === k) && !k.startsWith("lunch_"))
      .map((k): UsedFieldKeyOption => ({ kind: "used", key: `used:${k}`, field_key: k, label: k })),
  ];

  // Field-level reordering — separate DndContext from OptionsEditor's own
  // (scoped to a single field's option rows), so dragging a card doesn't
  // interfere with dragging an option within it.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: field.clientKey });
  const sortableStyle = { transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.6 : 1 };
  // The grip lives inside the collapsed Card, which has its own onClick to
  // expand — grabbing the grip shouldn't also trigger that.
  const gripProps = { ...attributes, ...listeners, onClick: (e: ReactMouseEvent) => e.stopPropagation() };

  // Every question_type switch drops whatever config keys belonged to the
  // *previous* type — e.g. short_text's max_length has nowhere to go on
  // multi_select_checkbox, and the backend's extra="forbid" config schemas
  // reject it outright rather than ignoring it. Landing on an option-bearing
  // type with no options yet (a fresh field, or one switched over from a
  // non-option type) also gets one starter row so there's always something
  // ready to edit rather than an empty list the TD has to click "Add option"
  // to even start on. Preset types (availability/event_preference/lunch)
  // aren't seeded here — their options come from EntityOptionsEditor/the
  // lunch picker, not a freeform starter row.
  function handleQuestionTypeChange(questionType: FormQuestionType) {
    const config = sanitizeConfigForType(field.config, questionType);
    const needsStarterOption = !preset && OPTION_BEARING_TYPES.includes(questionType) && !config.options?.length;
    onFieldChange({
      question_type: questionType,
      config: needsStarterOption ? { ...config, options: [newOption()] } : config,
    });
  }

  return (
    // Outer box stays untransformed so the shared toolbar can measure this
    // card's resting offsetTop/offsetHeight — sortable transform/opacity apply
    // one level in rather than on this node directly.
    <div data-field-card={field.clientKey} style={{ position: "relative" }}>
      <div ref={setNodeRef} style={sortableStyle}>
        {expanded ? (
          <Card radius="lg" borderColor={errors.length > 0 ? "var(--color-danger)" : "var(--color-border-strong)"} style={{ padding: "28px 24px 20px", position: "relative" }}>
            <div {...gripProps} style={{
              position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
              display: "flex", color: "var(--color-text-tertiary)", cursor: "grab", touchAction: "none",
            }}>
              <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <Input
                value={field.label}
                onChange={(e) => onFieldChange({ label: e.target.value })}
                placeholder="Question"
                fullWidth
              />
              <Dropdown
                value={field.question_type}
                onChange={(v) => handleQuestionTypeChange(v as FormQuestionType)}
                options={preset ? QUESTION_TYPE_OPTIONS.filter((o) => preset.allowedQuestionTypes.includes(o.value)) : QUESTION_TYPE_OPTIONS}
                width={220}
              />
            </div>
            <div style={{ marginBottom: field.showDescription ? "10px" : "16px" }}>
              <Combobox
                label="Field Key"
                labelExtra={
                  <Tooltip
                    variant="info"
                    maxWidth={400}
                    message="How this question shows up when scanning or filtering responses on the dashboard — not shown to respondents. Must be unique across every form this tournament owns."
                  >
                    <IconInfo size={12} style={{ color: "var(--color-text-tertiary)" }} />
                  </Tooltip>
                }
                value={fieldToComboboxValue(field.field_key)}
                onChange={(text, matched) => {
                  // A "used" row is always disabled (see getDisabled below), so Combobox
                  // never surfaces it here as matched — only a real preset can be.
                  if (matched?.kind === "preset") {
                    const questionType = matched.allowedQuestionTypes.includes(field.question_type) ? field.question_type : matched.defaultQuestionType;
                    onFieldChange({
                      field_key: matched.field_key,
                      question_type: questionType,
                      // Only sanitize when the type is actually changing — same-type
                      // presets (e.g. picking Availability while already on
                      // single_select_radio) shouldn't disturb existing config.
                      ...(questionType !== field.question_type ? { config: sanitizeConfigForType(field.config, questionType) } : {}),
                    });
                  } else {
                    onFieldChange({ field_key: text });
                  }
                }}
                options={comboOptions}
                getId={(p) => p.key}
                getLabel={(p) => p.label}
                getDisabled={(p) => p.kind === "used"}
                getDisabledReason={(p) => (p.kind === "used" ? "already in use" : undefined)}
                placeholder="e.g. volunteer_availability"
                allowFreeText
                size="md"
              />
            </div>
            {errors.length > 0 && (
              <ul style={{ margin: "0 0 12px", padding: "0 0 0 16px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
                {errors.map((message) => <li key={message}>{message}</li>)}
              </ul>
            )}
            {field.showDescription && (
              <div style={{ marginBottom: "16px" }}>
                <Input
                  value={field.description ?? ""}
                  onChange={(e) => onFieldChange({ description: e.target.value })}
                  placeholder="Description (optional)"
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
              tournamentId={tournamentId}
              branchTargets={branchTargets}
              branchingEnabled={branchingEnabled}
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
            borderColor={errors.length > 0 ? "var(--color-danger)" : undefined}
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
