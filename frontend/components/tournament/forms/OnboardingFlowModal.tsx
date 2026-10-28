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
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconCheck, IconForms, IconGripVertical, IconPlus, IconX } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { Popover } from "@/components/ui/Popover";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ApiError,
  type FormListItem,
  formsApi,
  type MembershipOnboardingStep,
  type PersonRef,
  rolesApi,
  tournamentOnboardingApi,
} from "@/lib/api";
import { prerequisiteSummary } from "@/lib/forms/prerequisites";
import { personName } from "@/lib/personDisplay";

/** The onboarding sequence: add, remove and reorder steps, saved together, and
 *  preview which steps a given member walks. */
export function OnboardingFlowModal({
  tournamentId,
  forms,
  lockedReason,
  onClose,
  onSaved,
}: {
  tournamentId: number;
  /** The forms list, which carries each form's onboarding_order. */
  forms: FormListItem[];
  /** Archived tournament — the sequence is frozen; previewing still works. */
  lockedReason?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const baseline = useMemo(
    () =>
      forms
        .filter((f) => f.onboarding_order != null)
        .sort((a, b) => (a.onboarding_order ?? 0) - (b.onboarding_order ?? 0)),
    [forms],
  );
  const [draft, setDraft] = useState<FormListItem[]>(baseline);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const [roleLabels, setRoleLabels] = useState<Map<number, string>>(new Map());
  const [members, setMembers] = useState<PersonRef[]>([]);
  const [memberText, setMemberText] = useState("");
  const [previewing, setPreviewing] = useState<PersonRef | null>(null);
  const [path, setPath] = useState<Map<string, MembershipOnboardingStep> | null>(null);

  useEffect(() => {
    rolesApi
      .list(tournamentId)
      .then((roles) => setRoleLabels(new Map(roles.map((r) => [r.id, r.label]))))
      .catch(() => {});
    // No conditions matches everyone, with their roles — and needs only manage_forms.
    formsApi
      .previewPrerequisites(tournamentId, { roles: [] })
      .then((refs) => setMembers(refs.filter((r) => r.membership_id != null)))
      .catch(() => {});
  }, [tournamentId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const draftIds = draft.map((f) => f.id);
  const dirty = draftIds.join(",") !== baseline.map((f) => f.id).join(",");
  const addable = forms.filter((f) => f.status !== "archived" && !draftIds.includes(f.id));
  const frozen = !!lockedReason || previewing !== null;

  function roleLabel(id: number) {
    return roleLabels.get(id) ?? "a deleted role";
  }

  async function preview(member: PersonRef | null) {
    setPreviewing(member);
    setPath(null);
    if (member?.membership_id == null) return;
    try {
      const steps = await tournamentOnboardingApi.path(tournamentId, member.membership_id);
      setPath(new Map(steps.map((s) => [s.form_id, s])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load that member's path.");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = draftIds.indexOf(String(active.id));
    const to = draftIds.indexOf(String(over.id));
    if (from !== -1 && to !== -1) setDraft(arrayMove(draft, from, to));
  }

  // Removals first, then additions (which append), then one reorder over the
  // resulting set — the reorder route only accepts exactly the current steps.
  async function handleSave() {
    setSaving(true);
    setError(undefined);
    try {
      const saved = new Set(baseline.map((f) => f.id));
      for (const form of baseline) {
        if (!draftIds.includes(form.id)) {
          await tournamentOnboardingApi.removeForm(tournamentId, form.id);
        }
      }
      for (const id of draftIds) {
        if (!saved.has(id)) await tournamentOnboardingApi.addForm(tournamentId, id);
      }
      if (draftIds.length > 0) await tournamentOnboardingApi.reorderForms(tournamentId, draftIds);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the onboarding sequence.");
      // Part of it may have saved; the list underneath should show what did.
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Onboarding"
      onClose={onClose}
      closeOnOverlayClick={!dirty}
      width={600}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {error && (
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <Button type="button" variant="secondary" size="md" fullWidth onClick={onClose}>
              {dirty ? "Cancel" : "Close"}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              fullWidth
              disabled={!dirty || !!lockedReason}
              loading={saving}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", marginBottom: "12px" }}>
        <div style={{ flex: 1 }}>
          <Combobox
            label="Preview as"
            options={members}
            getId={(m) => m.membership_id ?? 0}
            getLabel={personName}
            value={memberText}
            onChange={(text, matched) => {
              setMemberText(text);
              if (matched) preview(matched);
              else if (!text.trim()) preview(null);
            }}
            allowFreeText={false}
            placeholder="Everyone"
            size="sm"
            locked={dirty}
          />
        </div>
        <Popover
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={frozen}
              title={lockedReason}
            >
              <IconPlus size={13} /> Add form
            </Button>
          }
          items={addable}
          getKey={(f) => f.id}
          renderLabel={(f) => f.name}
          onSelect={(f) => setDraft([...draft, f])}
          emptyMessage="Every form is already a step."
          searchable
          width={280}
          align="right"
        />
      </div>
      {dirty && <p style={HINT}>Save or cancel your changes to preview a member&rsquo;s path.</p>}

      {draft.length === 0 ? (
        <EmptyState
          icon={<IconForms size={28} />}
          title="No onboarding steps"
          description="Add a form here, or turn on Onboarding step in a form's ⋮ menu."
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={draftIds} strategy={verticalListSortingStrategy}>
            {draft.map((form, i) => (
              <StepRow
                key={form.id}
                form={form}
                step={i + 1}
                frozen={frozen}
                summary={prerequisiteSummary(form.prerequisites, roleLabel)}
                previewStep={previewing ? (path?.get(form.id) ?? null) : undefined}
                onRemove={() => setDraft(draft.filter((f) => f.id !== form.id))}
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
                {draft.find((f) => f.id === activeId)?.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </Modal>
  );
}

const NAME = { fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500 } as const;
const HINT = {
  fontFamily: "var(--font-sans)",
  fontSize: "12px",
  color: "var(--color-text-tertiary)",
  marginBottom: "8px",
} as const;

function StepRow({
  form,
  step,
  frozen,
  summary,
  previewStep,
  onRemove,
}: {
  form: FormListItem;
  step: number;
  /** Archived tournament or a member preview — no dragging or removing. */
  frozen: boolean;
  summary: string | null;
  /** undefined: not previewing. null: previewing, and the step isn't on their path. */
  previewStep: MembershipOnboardingStep | null | undefined;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: form.id,
    disabled: frozen,
  });
  const offPath = previewStep === null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? undefined : CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0 : offPath ? 0.5 : 1,
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
          cursor: frozen ? "default" : "grab",
          touchAction: "none",
          visibility: frozen ? "hidden" : "visible",
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
          {previewStep?.completed && (
            <IconCheck size={12} style={{ color: "var(--color-success)" }} />
          )}
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
          {offPath && (
            <span style={{ ...HINT, marginBottom: 0, fontStyle: "italic" }}>Not on their path</span>
          )}
        </div>
        {summary && <span style={{ ...HINT, marginBottom: 0 }}>{summary}</span>}
      </div>
      {!frozen && (
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
