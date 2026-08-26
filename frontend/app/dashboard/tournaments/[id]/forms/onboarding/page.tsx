"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formsApi, tournamentOnboardingApi, FormListItem, OnboardingForm, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Popover } from "@/components/ui/Popover";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconEdit, IconForms, IconGripVertical, IconLock, IconPlus, IconTrash } from "@/components/ui/Icons";

export default function OnboardingFormsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageForms = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_forms");

  const [allForms, setAllForms] = useState<FormListItem[] | null>(null);
  const [baseline, setBaseline] = useState<OnboardingForm[] | null>(null);
  const [draft, setDraft] = useState<OnboardingForm[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!canManageForms) return;
    Promise.all([formsApi.listForTournament(tournamentId), tournamentOnboardingApi.listForms(tournamentId)])
      .then(([forms, onboarding]) => {
        setAllForms(forms);
        setBaseline(onboarding);
        setDraft(onboarding);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load onboarding forms."));
  }, [tournamentId, canManageForms]);

  // Only a published form not already an onboarding step can be added — the
  // backend rejects anything else (see add_onboarding_form's guard).
  const eligibleForms = useMemo(() => {
    const onboardingIds = new Set(draft.map((f) => f.id));
    return (allForms ?? []).filter((f) => f.status === "published" && !onboardingIds.has(f.id));
  }, [allForms, draft]);

  const isDirty = baseline !== null && draft.map((f) => f.id).join(",") !== baseline.map((f) => f.id).join(",");

  async function handleAdd(formId: string) {
    const created = await tournamentOnboardingApi.addForm(tournamentId, formId);
    const next = [...draft, created];
    setBaseline(next);
    setDraft(next);
  }

  async function handleRemove(formId: string) {
    setRemovingId(formId);
    try {
      await tournamentOnboardingApi.removeForm(tournamentId, formId);
      const next = draft.filter((f) => f.id !== formId);
      setBaseline(next);
      setDraft(next);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Failed to remove form from onboarding.");
    } finally {
      setRemovingId(null);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = draft.findIndex((f) => f.id === active.id);
    const newIndex = draft.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setDraft(arrayMove(draft, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);
    try {
      const updated = await tournamentOnboardingApi.reorderForms(tournamentId, draft.map((f) => f.id));
      setBaseline(updated);
      setDraft(updated);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Failed to save the new order.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (baseline) setDraft(baseline);
    setSaveError(undefined);
  }

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageForms) {
    return (
      <Card radius="lg" style={{ padding: "8px" }}>
        <EmptyState
          icon={<IconLock size={28} />}
          title="No access"
          description="You need the manage forms permission to view this page."
        />
      </Card>
    );
  }

  if (baseline === null || allForms === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <Popover
          trigger={
            <Button type="button" variant="primary" size="md">
              <IconPlus size={14} /> Add form
            </Button>
          }
          items={eligibleForms}
          getKey={(form) => form.id}
          renderLabel={(form) => form.name}
          onSelect={(form) => handleAdd(form.id)}
          emptyMessage="No published forms are available to add."
          width={300}
          align="right"
        />
      </div>

      {draft.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px", marginBottom: "16px" }}>
          <EmptyState
            icon={<IconForms size={28} />}
            title="No onboarding forms yet"
            description="Add a published form above to start the onboarding sequence."
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px", marginBottom: "16px" }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={draft.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {draft.map((form, i) => (
                <OnboardingFormRow
                  key={form.id}
                  form={form}
                  step={i + 1}
                  removing={removingId === form.id}
                  onEdit={() => window.open(`/forms/${form.id}/edit`, "_blank", "noopener,noreferrer")}
                  onRemove={() => handleRemove(form.id)}
                />
              ))}
            </SortableContext>
            <DragOverlay>
              {activeId && (
                <OnboardingFormPill form={draft.find((f) => f.id === activeId)!} dragging />
              )}
            </DragOverlay>
          </DndContext>
        </Card>
      )}

      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  );
}

function OnboardingFormPill({ form, dragging = false }: { form: OnboardingForm; dragging?: boolean }) {
  return (
    <div
      style={{
        boxSizing: "border-box",
        display: "flex", alignItems: "center", gap: "10px",
        height: "40px", padding: "0 12px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
        boxShadow: dragging ? "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))" : undefined,
        cursor: dragging ? "grabbing" : "grab",
      }}
    >
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, flex: 1 }}>{form.name}</span>
    </div>
  );
}

function OnboardingFormRow({ form, step, removing, onEdit, onRemove }: {
  form: OnboardingForm;
  step: number;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: form.id });
  const [hovered, setHovered] = useState(false);
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...style, position: "relative", display: "flex", alignItems: "center", gap: "20px", padding: "4px 10px" }}
    >
      <button
        type="button"
        aria-label={`Move ${form.name}`}
        {...attributes}
        {...listeners}
        style={{
          // The Card already owns the horizontal gutter. Keep the row's
          // left/right padding symmetric and let the hover-only grip occupy
          // that existing left gutter rather than creating a second inset.
          position: "absolute", left: "-7px", top: "50%", transform: "translateY(-50%)",
          display: "flex", padding: "2px", color: "var(--color-text-tertiary)",
          border: "none", background: "transparent", cursor: "grab", touchAction: "none",
          opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none", transition: "opacity 100ms ease",
        }}
      >
        <IconGripVertical size={16} />
      </button>
      <span style={{
        flexShrink: 0, minWidth: "22px", textAlign: "right",
        fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-tertiary)",
      }}>
        {step}.
      </span>
      <div style={{
        boxSizing: "border-box", flex: 1,
        display: "flex", alignItems: "center", gap: "10px",
        height: "40px", padding: "0",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
      }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, flex: 1 }}>{form.name}</span>
        <div style={{ display: "flex", gap: "6px" }}>
          <Button type="button" variant="secondary" size="sm" iconOnly title="Edit form" onClick={onEdit}>
            <IconEdit size={13} />
          </Button>
          <Button
            type="button" variant="secondary" size="sm" iconOnly loading={removing}
            title="Remove from onboarding"
            onClick={onRemove}
            style={{ color: "var(--color-danger)" }}
          >
            <IconTrash size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}
