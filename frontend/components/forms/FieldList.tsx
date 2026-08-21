"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { formsApi, Form } from "@/lib/api";
import { useFormValidation } from "@/lib/forms/useFormValidation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconForms, IconPlus } from "@/components/ui/Icons";
import { TOPBAR_HEIGHT } from "@/components/layout/Topbar";
import { FieldCard } from "@/components/forms/FieldCard";
import { FieldToolbar } from "@/components/forms/FieldToolbar";
import { EditableOption } from "@/components/forms/OptionsEditor";
import {
  EditableField, withOptionClientKeys, newField, toFieldInput,
} from "@/lib/forms/editableField";
import { DISPLAY_STYLE_TYPES } from "@/lib/forms/fieldTypes";

// Strict accordion — expanding a card collapses whatever was previously
// expanded; only one card is ever in edit mode at a time. Field edits are
// staged in local state, diffed against a JSON.stringify'd baseline
// snapshot of what was last loaded/saved — FloatingSaveBar shows whenever
// that diff is non-empty, and Save PUTs the whole field list in one batch
// (see the Edit Lifecycle notes on formsApi.putFields).
export function FieldList({ form }: { form: Form }) {
  const [fields, setFields] = useState<EditableField[]>(() =>
    form.fields
      .filter((f) => !f.is_archived)
      .sort((a, b) => a.order - b.order)
      .map((f) => ({ ...withOptionClientKeys(f), clientKey: String(f.id), showDescription: !!f.description }))
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [usedFieldKeys, setUsedFieldKeys] = useState<string[]>([]);
  // Set by add/duplicate so the effect below can scroll the new card into view
  // once its expand animation has settled at its real height.
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const validation = useFormValidation();
  const [saving, setSaving] = useState(false);
  // Baseline snapshot to diff against — set once on mount, then again after
  // every successful Save (the server's response, not what was submitted,
  // becomes the new baseline: it's the source of truth for server-assigned
  // ids/option_ids).
  const baselineRef = useRef<string | null>(null);
  if (baselineRef.current === null) baselineRef.current = JSON.stringify(fields);
  const isDirty = JSON.stringify(fields) !== baselineRef.current;

  const expandedField = fields.find((f) => f.clientKey === expandedKey);
  // Re-measure when cards are added/removed/reordered — but not on every
  // keystroke, which `fields` itself as a dep would do (new array each edit).
  const fieldOrderKey = fields.map((f) => f.clientKey).join(",");

  // Track the expanded card's offset/height so the toolbar follows it. A
  // ResizeObserver (not a one-shot measure) keeps the two in lockstep;
  // observing the list too catches offsetTop shifts when a sibling above it
  // expands/collapses or content changes height.
  useLayoutEffect(() => {
    const list = listRef.current;
    const box = toolbarRef.current;
    if (!expandedKey || !list || !box) return;
    const card = list.querySelector<HTMLElement>(`[data-field-card="${expandedKey}"]`);
    if (!card) return;
    const measure = () => {
      box.style.top = `${card.offsetTop}px`;
      box.style.height = `${card.offsetHeight}px`;
      box.style.visibility = "visible";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(list);
    return () => observer.disconnect();
  }, [expandedKey, fieldOrderKey]);

  useEffect(() => {
    if (!pendingScrollKey) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-field-card="${pendingScrollKey}"]`);
    setPendingScrollKey(null);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const safeTop = TOPBAR_HEIGHT + 12;
    if (rect.top >= safeTop && rect.bottom <= window.innerHeight) return;
    window.scrollTo({ top: window.scrollY + rect.top - safeTop - 8 });
  }, [pendingScrollKey]);

  // Fetched once per form-editing session (not per field card) — every
  // field's Combobox shares this list to flag already-used keys.
  useEffect(() => {
    if (form.tournament_id == null) return;
    formsApi.listFieldKeysForTournament(form.tournament_id).then(setUsedFieldKeys).catch(() => {});
  }, [form.tournament_id]);

  // Clicking outside every field card collapses whatever's expanded — an
  // expanded card isn't a required state, unlike a strict radio group.
  useEffect(() => {
    if (!expandedKey) return;
    function handleClick(e: MouseEvent) {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setExpandedKey(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expandedKey]);

  function updateField(clientKey: string, updates: Partial<EditableField>) {
    setFields((prev) => prev.map((f) => (f.clientKey === clientKey ? { ...f, ...updates } : f)));
  }

  function addField(afterClientKey?: string) {
    const insertIndex = afterClientKey ? fields.findIndex((f) => f.clientKey === afterClientKey) + 1 : fields.length;
    const field = newField(insertIndex + 1);
    setFields((prev) => {
      const next = [...prev];
      next.splice(insertIndex, 0, field);
      return next;
    });
    setExpandedKey(field.clientKey);
    setPendingScrollKey(field.clientKey);
  }

  // Cleared field_key on the copy — a reserved key (availability, ...) can
  // only exist once per tournament, and a freeform key the TD chose
  // deliberately shouldn't silently duplicate either.
  function duplicateField(clientKey: string) {
    const source = fields.find((f) => f.clientKey === clientKey);
    if (!source) return;
    const insertIndex = fields.findIndex((f) => f.clientKey === clientKey) + 1;
    const copy: EditableField = {
      ...source,
      clientKey: crypto.randomUUID(),
      id: null,
      field_key: "",
      config: source.config?.options
        ? { ...source.config, options: (source.config.options as EditableOption[]).map((o) => ({ ...o, clientKey: crypto.randomUUID(), option_id: "" })) }
        : source.config,
    };
    setFields((prev) => {
      const next = [...prev];
      next.splice(insertIndex, 0, copy);
      return next;
    });
    setExpandedKey(copy.clientKey);
    setPendingScrollKey(copy.clientKey);
  }

  function deleteField(clientKey: string) {
    setFields((prev) => prev.filter((f) => f.clientKey !== clientKey));
    setExpandedKey((prev) => (prev === clientKey ? null : prev));
  }

  async function handleSave() {
    const issues = validation.validate(fields);
    if (issues.length > 0) {
      setExpandedKey(issues[0].clientKey);
      return;
    }
    setSaving(true);
    try {
      const updated = await formsApi.putFields(form.id, fields.map(toFieldInput));
      const next = updated
        .filter((f) => !f.is_archived)
        .sort((a, b) => a.order - b.order)
        .map((f) => ({ ...withOptionClientKeys(f), clientKey: String(f.id), showDescription: !!f.description }));
      setFields(next);
      baselineRef.current = JSON.stringify(next);
      validation.clearAll();
    } catch (err) {
      validation.handle422(err);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setFields(baselineRef.current ? JSON.parse(baselineRef.current) : []);
    validation.clearAll();
    setExpandedKey(null);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.clientKey === active.id);
    const newIndex = fields.findIndex((f) => f.clientKey === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setFields((prev) => arrayMove(prev, oldIndex, newIndex));
  }

  return (
    <div ref={listRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "12px" }}>
      {fields.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconForms size={28} />}
            title="No fields yet"
            description="Add a field to start building this form."
            action={
              <Button type="button" variant="primary" size="sm" onClick={() => addField()}>
                <IconPlus size={14} /> Add field
              </Button>
            }
          />
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={fields.map((f) => f.clientKey)} strategy={verticalListSortingStrategy}>
            {fields.map((field) => (
              <FieldCard
                key={field.clientKey}
                field={field}
                expanded={expandedKey === field.clientKey}
                onExpand={() => setExpandedKey(field.clientKey)}
                onFieldChange={(updates) => updateField(field.clientKey, updates)}
                onDuplicate={() => duplicateField(field.clientKey)}
                onDelete={() => deleteField(field.clientKey)}
                tournamentId={form.tournament_id}
                usedFieldKeys={usedFieldKeys}
                allFields={fields}
                errors={validation.errorsFor(field.clientKey)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={validation.hasErrors ? `${validation.validationErrors.length} issue${validation.validationErrors.length !== 1 ? "s" : ""} — fix the highlighted questions below.` : validation.saveError || undefined}
        onSave={handleSave}
        onCancel={handleDiscard}
        stayWithin={`/forms/${form.id}`}
      />
      {expandedField && (
        <FieldToolbar
          boxRef={toolbarRef}
          showDescription={expandedField.showDescription}
          onAddFieldBelow={() => addField(expandedField.clientKey)}
          onToggleDescription={() =>
            updateField(expandedField.clientKey, { showDescription: !expandedField.showDescription })
          }
          displayStyle={DISPLAY_STYLE_TYPES.includes(expandedField.question_type) ? expandedField.config?.display_style ?? "list" : undefined}
          onToggleDisplayStyle={() =>
            updateField(expandedField.clientKey, {
              config: { ...expandedField.config, display_style: expandedField.config?.display_style === "buttons" ? "list" : "buttons" },
            })
          }
        />
      )}
    </div>
  );
}
