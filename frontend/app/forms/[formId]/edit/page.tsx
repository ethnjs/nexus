"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formsApi, Form, FormField, FormQuestionType, FormStatus, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EditableText } from "@/components/ui/EditableText";
import { EmptyState } from "@/components/ui/EmptyState";
import { Dropdown, DropdownItem } from "@/components/ui/Dropdown";
import { SplitButton, SplitButtonOption } from "@/components/ui/SplitButton";
import { IconArrowLeft, IconArchive, IconTrash, IconForms, IconGripVertical, IconX, IconPlus, IconDescription } from "@/components/ui/Icons";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";

// A field being edited in the builder — same shape as FormField, but `id`
// is null for a not-yet-saved field (PUT .../fields/ creates it on Save,
// per the Edit Lifecycle: an entry with no id means "create"). clientKey is
// the stable React/accordion identity regardless of whether id exists yet.
type EditableField = Omit<FormField, "id"> & { id: number | null; clientKey: string };

function newField(order: number): EditableField {
  return {
    clientKey: crypto.randomUUID(),
    id: null,
    form_id: "",
    field_key: "",
    order,
    label: "",
    description: null,
    question_type: "short_text",
    is_archived: false,
    config: { required: false, max_length: 500 },
    created_at: "",
    updated_at: "",
  };
}

// Matches the eventual centered content column (title card, field list) —
// the sub-header's content is constrained the same way, Google-Forms-style,
// rather than stretching edge to edge.
const CONTENT_MAX_WIDTH = 800;

const STATUS_BADGE_VARIANT: Record<FormStatus, "default" | "confirmed" | "removed"> = {
  draft: "default",
  published: "confirmed",
  archived: "removed",
};

function StatusControl({ form, onUpdated, onDeleted }: {
  form: Form;
  onUpdated: (form: Form) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function publish() {
    setBusy(true); setError(undefined);
    try {
      onUpdated(await formsApi.update(form.id, { status: "published" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to publish form.");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setError(undefined);
    try {
      onUpdated(await formsApi.archive(form.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to archive form.");
    }
  }

  async function deleteForm() {
    setError(undefined);
    try {
      await formsApi.delete(form.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete form.");
    }
  }

  const PRIMARY_LABEL: Record<FormStatus, string> = {
    draft: "Publish",
    published: "Published",
    archived: "Archived",
  };

  const options: SplitButtonOption[] = [
    ...(form.status !== "archived"
      ? [{ label: "Archive", subtitle: "Stop accepting responses", icon: <IconArchive size={14} />, action: archive }]
      : []),
    {
      label: "Delete",
      subtitle: "Permanently remove this form",
      icon: <IconTrash size={14} />,
      danger: true,
      disabled: form.response_count > 0,
      disabledReason: form.response_count > 0 ? "Archive instead — this form already has responses" : undefined,
      action: deleteForm,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
      <SplitButton
        label={PRIMARY_LABEL[form.status]}
        variant="primary"
        size="md"
        loading={busy}
        primaryDisabled={form.status !== "draft"}
        onClick={publish}
        options={options}
      />
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// Respondent-facing title/description — the first, most prominent card in
// the field list. Always editable-looking (not click-to-reveal like the
// sub-header's dashboard-facing name), using the app's standard Input/
// Textarea rather than an underline-only Google-Forms-style treatment.
function TitleCard({ form, onUpdated }: {
  form: Form;
  onUpdated: (form: Form) => void;
}) {
  const [title, setTitle] = useState(form.title ?? "");
  const [description, setDescription] = useState(form.description ?? "");
  const [error, setError] = useState<string | undefined>(undefined);

  async function saveTitle() {
    const trimmed = title.trim();
    if (trimmed === (form.title ?? "")) return;
    try {
      onUpdated(await formsApi.update(form.id, { title: trimmed }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update title.");
    }
  }

  async function saveDescription() {
    const trimmed = description.trim();
    if (trimmed === (form.description ?? "")) return;
    try {
      onUpdated(await formsApi.update(form.id, { description: trimmed }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update description.");
    }
  }

  return (
    <Card radius="lg" style={{ padding: "24px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        font="sans"
        size="lg"
        fullWidth
      />
      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={saveDescription}
        font="sans"
        rows={2}
        fullWidth
      />
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </Card>
  );
}

// Real question_type options + reserved presets below a separator. Picking
// a preset sets question_type and field_key together — no separate
// creation-time picker, it's all one dropdown. Lunch's field_key is left
// unset here since it's server-derived from a date+category picker that
// lands in a later step (the card body swap for reserved types generally).
const QUESTION_TYPE_OPTIONS: { value: FormQuestionType; label: string }[] = [
  { value: "short_text", label: "Short Answer" },
  { value: "long_text", label: "Paragraph" },
  { value: "single_select_radio", label: "Multiple Choice" },
  { value: "single_select_dropdown", label: "Dropdown" },
  { value: "multi_select_checkbox", label: "Checkboxes" },
  { value: "ranked_choice", label: "Ranked Choice" },
  { value: "acknowledgment", label: "Acknowledgment" },
];

const RESERVED_PRESETS: Record<string, { question_type: FormQuestionType; field_key: string; label: string }> = {
  "preset:availability_single": { question_type: "single_select_radio", field_key: "availability", label: "Availability (single choice)" },
  "preset:availability_multi": { question_type: "multi_select_checkbox", field_key: "availability", label: "Availability (multiple choice)" },
  "preset:event_preference": { question_type: "ranked_choice", field_key: "event_preference", label: "Event Preference" },
  "preset:lunch": { question_type: "single_select_radio", field_key: "", label: "Lunch" },
};

const QUESTION_TYPE_DROPDOWN_ITEMS: DropdownItem[] = [
  ...QUESTION_TYPE_OPTIONS,
  {
    group: "Reserved",
    options: Object.entries(RESERVED_PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
  },
];

// Reflects a field's current question_type/field_key back onto the dropdown
// — a reserved preset and its underlying question_type share the same
// question_type value, so the dropdown must key off field_key first to show
// the preset (not the plain type) as selected.
function fieldToDropdownValue(field: EditableField): string {
  const presetEntry = Object.entries(RESERVED_PRESETS).find(
    ([, preset]) => preset.field_key && preset.field_key === field.field_key && preset.question_type === field.question_type
  );
  if (presetEntry) return presetEntry[0];
  if (field.field_key?.startsWith("lunch_") && field.question_type === "single_select_radio") return "preset:lunch";
  return field.question_type;
}

function FieldCard({ field, expanded, onExpand, onCollapse, onFieldChange, onAddFieldBelow }: {
  field: EditableField;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onFieldChange: (updates: Partial<EditableField>) => void;
  onAddFieldBelow: () => void;
}) {
  const [showDescription, setShowDescription] = useState(!!field.description);

  if (!expanded) {
    return (
      <Card radius="lg" style={{ padding: "16px 20px", cursor: "pointer" }} onClick={onExpand}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px", color: "var(--color-text-tertiary)" }}>
          <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
        </div>
        <QuestionRenderer field={field} interactive={false} />
      </Card>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <Card radius="lg" borderColor="var(--color-border-strong)" style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: showDescription ? "10px" : "16px" }}>
          <Input
            value={field.label}
            onChange={(e) => onFieldChange({ label: e.target.value })}
            placeholder="Question"
            fullWidth
          />
          <Dropdown
            value={fieldToDropdownValue(field)}
            onChange={(v) => {
              const preset = RESERVED_PRESETS[v];
              if (preset) onFieldChange({ question_type: preset.question_type, field_key: preset.field_key });
              else onFieldChange({ question_type: v as FormQuestionType });
            }}
            options={QUESTION_TYPE_DROPDOWN_ITEMS}
            width={220}
          />
          <Button type="button" variant="ghost" size="sm" iconOnly title="Collapse" onClick={onCollapse}>
            <IconX size={14} />
          </Button>
        </div>
        {showDescription && (
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
        <QuestionRenderer field={field} interactive={false} />
      </Card>

      {/* Floating toolbar — add a field below, toggle this field's description input. */}
      <div style={{
        position: "absolute", top: 0, left: "100%", marginLeft: "10px",
        display: "flex", flexDirection: "column", gap: "6px",
      }}>
        <Button type="button" variant="secondary" size="sm" iconOnly title="Add field below" onClick={onAddFieldBelow}>
          <IconPlus size={14} />
        </Button>
        <Button
          type="button" variant={showDescription ? "primary" : "secondary"} size="sm" iconOnly
          title="Toggle description"
          onClick={() => setShowDescription((v) => !v)}
        >
          <IconDescription size={14} />
        </Button>
      </div>
    </div>
  );
}

// Strict accordion — expanding a card collapses whatever was previously
// expanded; only one card is ever in edit mode at a time. Field edits are
// staged in local state only for now — persisting via PUT .../fields/ and
// the option_id echo-back requirement land in a later step.
function FieldList({ form }: { form: Form }) {
  const [fields, setFields] = useState<EditableField[]>(() =>
    form.fields
      .filter((f) => !f.is_archived)
      .sort((a, b) => a.order - b.order)
      .map((f) => ({ ...f, clientKey: String(f.id) }))
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
  }

  if (fields.length === 0) {
    return (
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
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {fields.map((field) => (
        <FieldCard
          key={field.clientKey}
          field={field}
          expanded={expandedKey === field.clientKey}
          onExpand={() => setExpandedKey(field.clientKey)}
          onCollapse={() => setExpandedKey(null)}
          onFieldChange={(updates) => updateField(field.clientKey, updates)}
          onAddFieldBelow={() => addField(field.clientKey)}
        />
      ))}
    </div>
  );
}

function SubHeader({ form, onUpdated, onDeleted }: {
  form: Form;
  onUpdated: (form: Form) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const backHref = form.owner_type === "tournament" ? `/dashboard/tournaments/${form.tournament_id}/forms` : null;

  return (
    <div style={{ maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "16px 24px 0" }}>
      <Card radius="lg" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
        padding: "12px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
          <Button
            type="button" variant="ghost" size="sm" iconOnly
            title="Back to forms"
            onClick={() => (backHref ? router.push(backHref) : router.back())}
          >
            <IconArrowLeft size={14} />
          </Button>
          <EditableText
            value={form.name}
            onSave={async (name) => onUpdated(await formsApi.update(form.id, { name }))}
            textStyle={{ fontSize: "15px", fontWeight: 600 }}
            title="Click to edit name"
          />
          <Badge variant={STATUS_BADGE_VARIANT[form.status]}>{form.status}</Badge>
        </div>
        <StatusControl form={form} onUpdated={onUpdated} onDeleted={onDeleted} />
      </Card>
    </div>
  );
}

export default function FormEditPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);
  const router = useRouter();

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load form."));
  }, [formId]);

  function handleDeleted() {
    if (form?.owner_type === "tournament") {
      router.push(`/dashboard/tournaments/${form.tournament_id}/forms`);
    } else {
      router.back();
    }
  }

  if (loadError) {
    return (
      <div style={{ padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <SubHeader form={form} onUpdated={setForm} onDeleted={handleDeleted} />
      <div style={{ maxWidth: `${CONTENT_MAX_WIDTH}px`, margin: "0 auto", padding: "22px 24px" }}>
        <TitleCard form={form} onUpdated={setForm} />
        <FieldList form={form} />
      </div>
    </div>
  );
}
