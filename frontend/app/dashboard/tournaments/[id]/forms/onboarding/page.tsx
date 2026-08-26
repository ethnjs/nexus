"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ApiError, FormListItem, OnboardingForm, formsApi, onboardingFormsApi } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { IconEdit, IconForms, IconGripVertical, IconLock, IconPlus, IconTrash } from "@/components/ui/Icons";

function SortableOnboardingRow({ form, index, onEdit, onRemove, saving }: {
  form: OnboardingForm;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: form.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px",
        borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)",
        transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1,
      }}
    >
      <button
        type="button"
        aria-label={`Move ${form.name}`}
        disabled={saving}
        {...attributes}
        {...listeners}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", padding: "2px",
          color: "var(--color-text-tertiary)", background: "transparent", border: "none",
          cursor: saving ? "default" : "grab", touchAction: "none",
        }}
      >
        <IconGripVertical size={16} />
      </button>
      <span style={{
        width: "22px", flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "12px",
        color: "var(--color-text-tertiary)", textAlign: "right",
      }}>
        {index + 1}.
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {form.name}
        </p>
        {form.description && (
          <p style={{ marginTop: "2px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {form.description}
          </p>
        )}
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
        {form.response_count} responses
      </span>
      <div style={{ display: "flex", gap: "6px" }}>
        <Button type="button" variant="secondary" size="sm" iconOnly title="Edit form" onClick={onEdit}>
          <IconEdit size={14} />
        </Button>
        <Button type="button" variant="ghost" size="sm" iconOnly title="Remove from onboarding" disabled={saving} onClick={onRemove}>
          <IconTrash size={14} />
        </Button>
      </div>
    </div>
  );
}

export default function OnboardingFormsPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageForms = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_forms");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [allForms, setAllForms] = useState<FormListItem[] | null>(null);
  const [steps, setSteps] = useState<OnboardingForm[] | null>(null);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManageForms) return;
    Promise.all([formsApi.listForTournament(tournamentId), onboardingFormsApi.list(tournamentId)])
      .then(([forms, onboarding]) => {
        setAllForms(forms);
        setSteps(onboarding);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Failed to load onboarding forms.");
        setAllForms([]);
        setSteps([]);
      });
  }, [canManageForms, tournamentId]);

  async function addForm() {
    if (!selectedFormId) return;
    setSaving(true);
    setError(null);
    try {
      const step = await onboardingFormsApi.add(tournamentId, selectedFormId);
      setSteps((current) => [...(current ?? []), step].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      setSelectedFormId("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add the form to onboarding.");
    } finally {
      setSaving(false);
    }
  }

  async function removeForm(formId: string) {
    setSaving(true);
    setError(null);
    try {
      await onboardingFormsApi.remove(tournamentId, formId);
      setSteps((current) => (current ?? []).filter((form) => form.id !== formId).map((form, index) => ({ ...form, order: index + 1 })));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to remove the form from onboarding.");
    } finally {
      setSaving(false);
    }
  }

  async function reorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !steps) return;
    const oldIndex = steps.findIndex((form) => form.id === active.id);
    const newIndex = steps.findIndex((form) => form.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = steps;
    const next = arrayMove(steps, oldIndex, newIndex).map((form, index) => ({ ...form, order: index + 1 }));
    setSteps(next);
    setSaving(true);
    setError(null);
    try {
      const saved = await onboardingFormsApi.reorder(tournamentId, next.map((form) => form.id));
      setSteps(saved);
    } catch (e) {
      setSteps(previous);
      setError(e instanceof ApiError ? e.message : "Failed to save the new order.");
    } finally {
      setSaving(false);
    }
  }

  if (membershipLoading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
  }

  if (!canManageForms) {
    return (
      <Card radius="lg" style={{ padding: "8px" }}>
        <EmptyState icon={<IconLock size={28} />} title="No access" description="You need the manage forms permission to configure onboarding." />
      </Card>
    );
  }

  if (allForms === null || steps === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>
    );
  }

  const onboardingIds = new Set(steps.map((form) => form.id));
  const availableForms = allForms.filter((form) => form.status === "published" && !onboardingIds.has(form.id));

  return (
    <div>
      {error && <p style={{ marginBottom: "12px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>}

      <Card radius="lg" style={{ padding: "16px", marginBottom: "16px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}>Add an onboarding form</p>
        <p style={{ marginTop: "3px", marginBottom: "12px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
          Only published forms are available. Adding a form asks previously completed members to complete the expanded sequence.
        </p>
        <div style={{ display: "flex", gap: "8px", maxWidth: "520px" }}>
          <div style={{ flex: 1 }}>
            <Dropdown
              value={selectedFormId}
              onChange={setSelectedFormId}
              options={availableForms.map((form) => ({ value: form.id, label: form.name, subtitle: form.description ?? undefined }))}
              placeholder={availableForms.length ? "Choose a published form" : "No published forms available"}
              locked={saving || availableForms.length === 0}
              fullWidth
              searchable
            />
          </div>
          <Button type="button" variant="primary" size="md" disabled={!selectedFormId || saving} loading={saving} onClick={addForm}>
            <IconPlus size={14} /> Add
          </Button>
        </div>
      </Card>

      {steps.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState icon={<IconForms size={28} />} title="No onboarding forms" description="Add published forms above to build the member onboarding sequence." />
        </Card>
      ) : (
        <Card radius="lg" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px", borderBottom: "1px solid var(--color-border)" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}>Onboarding sequence</p>
            <p style={{ marginTop: "3px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>Drag forms to set the order members see them.</p>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
            <SortableContext items={steps.map((form) => form.id)} strategy={verticalListSortingStrategy}>
              {steps.map((form, index) => (
                <SortableOnboardingRow
                  key={form.id}
                  form={form}
                  index={index}
                  saving={saving}
                  onEdit={() => router.push(`/forms/${form.id}/edit`)}
                  onRemove={() => removeForm(form.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </Card>
      )}
    </div>
  );
}
