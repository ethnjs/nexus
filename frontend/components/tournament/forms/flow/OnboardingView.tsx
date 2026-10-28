"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { FlowPane, FlowTitle } from "@/components/tournament/forms/flow/FlowPane";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconForms, IconGripVertical, IconPlus, IconX } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import { Tooltip } from "@/components/ui/Tooltip";
import { ApiError, type FormListItem, tournamentOnboardingApi } from "@/lib/api";
import { prerequisiteSummary } from "@/lib/forms/prerequisites";

/** The onboarding sequence: add, remove and reorder steps, saved together. */
export function OnboardingView({
  tournamentId,
  forms,
  roleLabel,
  lockedReason,
  onDirtyChange,
  onSaved,
}: {
  tournamentId: number;
  forms: FormListItem[];
  roleLabel: (id: number) => string;
  lockedReason?: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const baseline = useMemo(
    () =>
      forms
        .filter((f) => f.onboarding_order != null)
        .sort((a, b) => (a.onboarding_order ?? 0) - (b.onboarding_order ?? 0)),
    [forms],
  );
  // null until edited, so a reloaded list shows through instead of a stale copy.
  const [edited, setEdited] = useState<FormListItem[] | null>(null);
  const steps = edited ?? baseline;
  const stepIds = steps.map((f) => f.id);
  const dirty = edited !== null && stepIds.join(",") !== baseline.map((f) => f.id).join(",");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const addable = forms.filter((f) => f.status !== "archived" && !stepIds.includes(f.id));

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = stepIds.indexOf(String(active.id));
    const to = stepIds.indexOf(String(over.id));
    if (from !== -1 && to !== -1) setEdited(arrayMove(steps, from, to));
  }

  // Removals first, then additions (which append), then one reorder over the
  // resulting set — the reorder route only accepts exactly the current steps.
  async function handleSave() {
    setSaving(true);
    setError(undefined);
    try {
      const saved = new Set(baseline.map((f) => f.id));
      for (const form of baseline) {
        if (!stepIds.includes(form.id)) {
          await tournamentOnboardingApi.removeForm(tournamentId, form.id);
        }
      }
      for (const id of stepIds) {
        if (!saved.has(id)) await tournamentOnboardingApi.addForm(tournamentId, id);
      }
      if (stepIds.length > 0) await tournamentOnboardingApi.reorderForms(tournamentId, stepIds);
      setEdited(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the onboarding sequence.");
    } finally {
      setSaving(false);
      // Part of a failed save may have gone through; the list should show what did.
      onSaved();
    }
  }

  return (
    <FlowPane
      title={<FlowTitle>Onboarding</FlowTitle>}
      actions={
        <Popover
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!!lockedReason}
              title={lockedReason}
            >
              <IconPlus size={13} /> Add form
            </Button>
          }
          items={addable}
          getKey={(f) => f.id}
          renderLabel={(f) => f.name}
          onSelect={(f) => setEdited([...steps, f])}
          emptyMessage="Every form is already a step."
          searchable
          width={280}
          align="right"
        />
      }
      dirty={dirty}
      saving={saving}
      error={error}
      lockedReason={lockedReason}
      onSave={handleSave}
      onCancel={() => {
        setEdited(null);
        setError(undefined);
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: "var(--color-text-secondary)",
          marginBottom: "12px",
        }}
      >
        New members fill these out in order before reaching the rest of the tournament. A step whose
        prerequisites a member doesn&rsquo;t meet is skipped for them.
      </p>
      {steps.length === 0 ? (
        <EmptyState
          icon={<IconForms size={28} />}
          title="No onboarding steps"
          description="Add a form to start the sequence."
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
            {steps.map((form, i) => (
              <StepRow
                key={form.id}
                form={form}
                step={i + 1}
                locked={!!lockedReason}
                summary={prerequisiteSummary(form.prerequisites, roleLabel)}
                onRemove={() => setEdited(steps.filter((f) => f.id !== form.id))}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeId && (
              <div
                style={{
                  ...NAME,
                  padding: "10px 12px",
                  background: "var(--color-surface)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-md)",
                }}
              >
                {steps.find((f) => f.id === activeId)?.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </FlowPane>
  );
}

const NAME = { fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 } as const;
const HINT = {
  fontFamily: "var(--font-sans)",
  fontSize: "12px",
  color: "var(--color-text-tertiary)",
} as const;

function StepRow({
  form,
  step,
  locked,
  summary,
  onRemove,
}: {
  form: FormListItem;
  step: number;
  /** Archived tournament — no dragging or removing. */
  locked: boolean;
  summary: string | null;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: form.id,
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? undefined : CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 4px",
        borderTop: step > 1 ? "1px solid var(--color-border)" : undefined,
      }}
    >
      <button
        type="button"
        aria-label={`Move ${form.name}`}
        {...attributes}
        {...listeners}
        style={{
          display: "flex",
          padding: "2px",
          border: "none",
          background: "transparent",
          color: "var(--color-text-tertiary)",
          cursor: locked ? "default" : "grab",
          touchAction: "none",
          visibility: locked ? "hidden" : "visible",
        }}
      >
        <IconGripVertical size={16} />
      </button>
      <span
        style={{
          minWidth: "20px",
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          color: "var(--color-text-tertiary)",
        }}
      >
        {step}.
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={NAME}>{form.name}</span>
          {form.status === "draft" && (
            <Tooltip
              variant="info"
              message="Members skip this step until it's published, then see it in their flow."
              showIcon={false}
            >
              <Badge variant="warning">Draft</Badge>
            </Tooltip>
          )}
          {form.status === "archived" && (
            <Tooltip
              variant="info"
              message="Only members who answered it before it was archived keep it on their path."
              showIcon={false}
            >
              <Badge variant="removed">Archived</Badge>
            </Tooltip>
          )}
        </div>
        {summary && <span style={HINT}>{summary}</span>}
      </div>
      {!locked && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          title="Remove from onboarding"
          onClick={onRemove}
        >
          <IconX size={12} />
        </Button>
      )}
    </div>
  );
}
