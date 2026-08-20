"use client";

import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { Dropdown } from "@/components/ui/Dropdown";
import { Combobox } from "@/components/ui/Combobox";
import { Tooltip } from "@/components/ui/Tooltip";
import { SplitButton, SplitButtonOption } from "@/components/ui/SplitButton";
import { IconArrowLeft, IconArchive, IconTrash, IconForms, IconGripVertical, IconPlus, IconDescription, IconInfo } from "@/components/ui/Icons";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { OptionsEditor, EditableOption } from "@/components/forms/OptionsEditor";
import { EntityOptionsEditor } from "@/components/forms/EntityOptionsEditor";

// A field being edited in the builder — same shape as FormField, but `id`
// is null for a not-yet-saved field (PUT .../fields/ creates it on Save,
// per the Edit Lifecycle: an entry with no id means "create"). clientKey is
// the stable React/accordion identity regardless of whether id exists yet.
type EditableField = Omit<FormField, "id"> & { id: number | null; clientKey: string };

// Attaches a stable clientKey to every option in a loaded field's config —
// options fetched from the server have a real option_id (usable as the key)
// but no clientKey, which OptionsEditor's rows and dnd-kit both need.
function withOptionClientKeys(field: FormField): FormField {
  if (!field.config?.options?.length) return field;
  return {
    ...field,
    config: {
      ...field.config,
      options: field.config.options.map((opt) => ({ ...opt, clientKey: opt.option_id } as EditableOption)),
    },
  };
}

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

// Plain question_type options — no reserved presets here (see FIELD_KEY_PRESETS).
const QUESTION_TYPE_OPTIONS: { value: FormQuestionType; label: string }[] = [
  { value: "short_text", label: "Short Answer" },
  { value: "long_text", label: "Paragraph" },
  { value: "single_select_radio", label: "Multiple Choice" },
  { value: "single_select_dropdown", label: "Dropdown" },
  { value: "multi_select_checkbox", label: "Checkboxes" },
  { value: "ranked_choice", label: "Ranked Choice" },
  { value: "acknowledgment", label: "Acknowledgment" },
];

// Types whose card body is a freeform options editor rather than a plain
// preview. Excludes availability/event_preference (entity-backed options
// sourced from real tournament data, not freeform rows — a later step) even
// though they reuse these same question_types; gated on !activePreset(field).
const OPTION_BEARING_TYPES: FormQuestionType[] = [
  "single_select_radio", "single_select_dropdown", "multi_select_checkbox", "ranked_choice",
];

// Reserved field_key presets, picked from the field_key Combobox rather than
// the question_type Dropdown — selecting one sets field_key, and constrains
// question_type to whichever of allowedQuestionTypes fits (switching to
// defaultQuestionType if the current type isn't one of them). Matches
// RESERVED_FIELD_KEY_QUESTION_TYPES / LUNCH_QUESTION_TYPES in
// backend/app/core/form/validation.py — keep in sync if those change.
// Lunch's field_key is a "lunch_" sentinel (not a real key yet) since the
// real key is server-derived from a date+category picker that lands in a
// later step (the card body swap for reserved types generally).
interface FieldKeyPreset {
  kind: "preset";
  key: string;
  field_key: string;
  label: string;
  allowedQuestionTypes: FormQuestionType[];
  defaultQuestionType: FormQuestionType;
}

const FIELD_KEY_PRESETS: FieldKeyPreset[] = [
  { kind: "preset", key: "availability", field_key: "availability", label: "Availability", allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"], defaultQuestionType: "single_select_radio" },
  { kind: "preset", key: "event_preference", field_key: "event_preference", label: "Event Preference", allowedQuestionTypes: ["ranked_choice", "multi_select_checkbox", "single_select_dropdown"], defaultQuestionType: "ranked_choice" },
  { kind: "preset", key: "lunch", field_key: "lunch_", label: "Lunch", allowedQuestionTypes: ["single_select_radio", "multi_select_checkbox"], defaultQuestionType: "single_select_radio" },
];

// A field_key already used elsewhere in this tournament — shown in the
// Combobox as a visibly disabled row (not selectable, not hidden) rather
// than letting the TD type it and only discover the collision from the
// 409 PUT .../fields/ would otherwise return.
interface UsedFieldKeyOption {
  kind: "used";
  key: string;
  field_key: string;
  label: string;
}

type FieldKeyComboOption = FieldKeyPreset | UsedFieldKeyOption;

// The preset currently active on a field, if any — its field_key (or, for
// Lunch, the "lunch_" sentinel prefix) matches what's stored.
function activePreset(field: EditableField): FieldKeyPreset | undefined {
  return FIELD_KEY_PRESETS.find((p) =>
    p.key === "lunch" ? field.field_key.startsWith("lunch_") : p.field_key === field.field_key
  );
}

// Reflects a field's current field_key back onto the Combobox — shows the
// preset's descriptive label when active, the raw field_key otherwise (a
// custom TD-typed key).
function fieldToComboboxValue(field: EditableField): string {
  return activePreset(field)?.label ?? field.field_key;
}

// lunch_{YYYYMMDD}_{category} — one date+category pair per lunch field (not
// per option; the options below are just that lunch's food choices).
// Matches LUNCH_FIELD_KEY_PATTERN in backend/app/core/form/validation.py.
function parseLunchFieldKey(fieldKey: string): { date: string; category: string } {
  const match = /^lunch_(\d{4})(\d{2})(\d{2})_([a-z0-9_]+)$/.exec(fieldKey);
  if (!match) return { date: "", category: "" };
  const [, y, m, d, category] = match;
  return { date: `${y}-${m}-${d}`, category };
}

function buildLunchFieldKey(date: string, category: string): string {
  const slug = category.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!date || !slug) return "lunch_";
  return `lunch_${date.replaceAll("-", "")}_${slug}`;
}

// Lunch's card body: a date + category picker (the field-level key
// derivation), not a per-option picker — the options below are just that
// lunch's food choices, edited with the same freeform OptionsEditor as any
// other select/checkbox field.
function LunchFieldBody({ field, onFieldChange }: {
  field: EditableField;
  onFieldChange: (updates: Partial<EditableField>) => void;
}) {
  const { date, category } = parseLunchFieldKey(field.field_key);

  function setDate(newDate: string) {
    onFieldChange({ field_key: buildLunchFieldKey(newDate, category) });
  }

  function setCategory(newCategory: string) {
    onFieldChange({ field_key: buildLunchFieldKey(date, newCategory) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", gap: "10px" }}>
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} size="sm" fullWidth />
        <Input label="Category" placeholder="e.g. Protein" value={category} onChange={(e) => setCategory(e.target.value)} size="sm" fullWidth />
      </div>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
        {field.field_key === "lunch_" ? "Set a date and category to derive the field key" : field.field_key}
      </p>
      <OptionsEditor
        options={(field.config?.options as EditableOption[] | undefined) ?? []}
        onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
        questionType={field.question_type}
      />
    </div>
  );
}

const EXPAND_MS = 200;
const EXPAND_EASING = "ease-out";

// Animates a card between its collapsed and expanded heights, Google-Forms
// style, so the cards below reflow smoothly instead of snapping.
//
// Why this is imperative rather than a `height` prop driven by state: React
// reuses the same DOM nodes across the collapsed/expanded branches, so a
// mount-triggered effect never re-fires on a *prop* flip — it would only
// animate brand-new cards. Measuring with a ResizeObserver sidesteps mounting —
// swapping the branch changes the content's natural height, the observer sees
// it, and we write the new height onto the clipping wrapper, which transitions.
// It also gets height animation on any *other* content change for free (e.g.
// toggling the description input) with no extra wiring.
function useHeightTransition(expandedOnMount: boolean) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    // `overflow: hidden` is what makes the height animation read as a reveal
    // rather than a clip-free resize — but it would also clip the Combobox /
    // Tooltip popups that hang outside the card, so it's only on while a
    // transition is actually running.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const clipDuring = (ms: number) => {
      wrapper.style.overflow = "hidden";
      clearTimeout(settle);
      settle = setTimeout(() => { wrapper.style.overflow = "visible"; }, ms);
    };

    // Pin an explicit start height before the first paint. A card that mounts
    // already expanded is a just-added field, so it grows in from 0; every
    // other card just sits at its natural height with nothing to animate.
    wrapper.style.transition = "none";
    wrapper.style.height = expandedOnMount ? "0px" : `${content.offsetHeight}px`;
    if (expandedOnMount) clipDuring(EXPAND_MS);
    wrapper.getBoundingClientRect(); // forces a style flush, so the start height is a real computed value to transition from
    wrapper.style.transition = `height ${EXPAND_MS}ms ${EXPAND_EASING}`;

    const observer = new ResizeObserver(() => {
      const next = `${content.offsetHeight}px`;
      if (next === wrapper.style.height) return;
      clipDuring(EXPAND_MS);
      wrapper.style.height = next;
    });
    observer.observe(content);
    return () => { observer.disconnect(); clearTimeout(settle); };
  }, [expandedOnMount]);

  return { wrapperRef, contentRef };
}

function FieldCard({ field, expanded, onExpand, onFieldChange, onAddFieldBelow, tournamentId, usedFieldKeys }: {
  field: EditableField;
  expanded: boolean;
  onExpand: () => void;
  onFieldChange: (updates: Partial<EditableField>) => void;
  onAddFieldBelow: () => void;
  tournamentId: number | null;
  usedFieldKeys: string[];
}) {
  const [showDescription, setShowDescription] = useState(!!field.description);
  const [hovered, setHovered] = useState(false);
  const preset = activePreset(field);

  // Reserved key names are already represented by FIELD_KEY_PRESETS, and a
  // field editing its own already-saved key shouldn't see that key flagged
  // as "taken" by itself.
  const comboOptions: FieldKeyComboOption[] = [
    ...FIELD_KEY_PRESETS,
    ...usedFieldKeys
      .filter((k) => k !== field.field_key && !FIELD_KEY_PRESETS.some((p) => p.field_key === k) && !k.startsWith("lunch_"))
      .map((k): UsedFieldKeyOption => ({ kind: "used", key: `used:${k}`, field_key: k, label: k })),
  ];

  const expandedOnMount = useRef(expanded).current;
  const { wrapperRef, contentRef } = useHeightTransition(expandedOnMount);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Cross-fade the swapped-in content alongside the height change. WAAPI
  // rather than a CSS transition because there's nothing to transition *from*
  // — the two branches are different subtrees, and .animate() replays on every
  // call, so unlike a mount effect it fires on each expand/collapse.
  useLayoutEffect(() => {
    const timing = { duration: EXPAND_MS, easing: EXPAND_EASING };
    contentRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    toolbarRef.current?.animate(
      [{ opacity: 0, transform: "translateX(-6px)" }, { opacity: 1, transform: "none" }],
      timing,
    );
  }, [expanded, contentRef]);

  return (
    // Outer box stays untransformed and unclipped so the floating toolbar can
    // hang off it at left: 100% — do not put overflow/transform here.
    <div style={{ position: "relative" }}>
      <div ref={wrapperRef}>
        <div ref={contentRef}>
          {expanded ? (
            <Card radius="lg" borderColor="var(--color-border-strong)" style={{ padding: "28px 24px 20px", position: "relative" }}>
              <div style={{
                position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
                display: "flex", color: "var(--color-text-tertiary)", cursor: "grab",
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
                  onChange={(v) => onFieldChange({ question_type: v as FormQuestionType })}
                  options={preset ? QUESTION_TYPE_OPTIONS.filter((o) => preset.allowedQuestionTypes.includes(o.value)) : QUESTION_TYPE_OPTIONS}
                  width={220}
                />
              </div>
              <div style={{ marginBottom: showDescription ? "10px" : "16px" }}>
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
                  value={fieldToComboboxValue(field)}
                  onChange={(text, matched) => {
                    // A "used" row is always disabled (see getDisabled below), so Combobox
                    // never surfaces it here as matched — only a real preset can be.
                    if (matched?.kind === "preset") {
                      onFieldChange({
                        field_key: matched.field_key,
                        question_type: matched.allowedQuestionTypes.includes(field.question_type) ? field.question_type : matched.defaultQuestionType,
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
              {(preset?.key === "availability" || preset?.key === "event_preference") && tournamentId ? (
                <EntityOptionsEditor
                  fieldKey={preset.key}
                  tournamentId={tournamentId}
                  questionType={field.question_type}
                  options={(field.config?.options as EditableOption[] | undefined) ?? []}
                  onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
                />
              ) : preset?.key === "lunch" ? (
                <LunchFieldBody field={field} onFieldChange={onFieldChange} />
              ) : !preset && OPTION_BEARING_TYPES.includes(field.question_type) ? (
                <>
                  <OptionsEditor
                    options={(field.config?.options as EditableOption[] | undefined) ?? []}
                    onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
                    questionType={field.question_type}
                  />
                  {field.question_type === "ranked_choice" && (
                    <div style={{ marginTop: "12px", width: "100px" }}>
                      <Input
                        label="Ranks"
                        type="number"
                        min={1}
                        value={String(field.config?.ranks ?? 1)}
                        onChange={(e) => onFieldChange({ config: { ...field.config, ranks: Math.max(1, Number(e.target.value) || 1) } })}
                        size="sm"
                        fullWidth
                      />
                    </div>
                  )}
                </>
              ) : (
                <QuestionRenderer field={field} interactive={false} showHeader={false} />
              )}
            </Card>
          ) : (
            <Card
              radius="lg"
              style={{ padding: "20px 24px", cursor: "pointer", position: "relative" }}
              onClick={onExpand}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              <div style={{
                position: "absolute", top: "6px", left: "50%", transform: "translateX(-50%)",
                display: "flex", color: "var(--color-text-tertiary)", cursor: "grab",
                opacity: hovered ? 1 : 0, transition: "opacity 100ms ease",
              }}>
                <IconGripVertical size={14} style={{ transform: "rotate(90deg)" }} />
              </div>
              <QuestionRenderer field={field} interactive={false} />
            </Card>
          )}
        </div>
      </div>

      {/* Floating toolbar — add a field below, toggle this field's description input. */}
      {expanded && (
        <div ref={toolbarRef} style={{
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
      )}
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
      .map((f) => ({ ...withOptionClientKeys(f), clientKey: String(f.id) }))
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [usedFieldKeys, setUsedFieldKeys] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

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
    <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {fields.map((field) => (
        <FieldCard
          key={field.clientKey}
          field={field}
          expanded={expandedKey === field.clientKey}
          onExpand={() => setExpandedKey(field.clientKey)}
          onFieldChange={(updates) => updateField(field.clientKey, updates)}
          onAddFieldBelow={() => addField(field.clientKey)}
          tournamentId={form.tournament_id}
          usedFieldKeys={usedFieldKeys}
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
