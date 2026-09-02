"use client";

import { useState } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { EditableText } from "@/components/ui/EditableText";
import { Toggle } from "@/components/ui/Toggle";
import { Checkbox } from "@/components/ui/Checkbox";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { IconGripVertical, IconTrash, IconPlus, IconChevronDown, IconChevronRight } from "@/components/ui/Icons";
import { DisplayConfigSection, DisplayConfigSectionCatalogItem } from "@/lib/api";
import { useDisplayConfigDraft } from "@/lib/useDisplayConfigDraft";
import { MEMBERS_PANEL } from "@/lib/displayConfigSurfaces";
import {
  CUSTOM_SECTION_PREFIX, DEFAULT_CUSTOM_SECTION_TITLE, isCustomSection, resolveSections,
} from "@/lib/panelSections";

interface PanelSectionsModalProps {
  tournamentId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// A custom section's id has to survive renames and reordering — the fields
// assigned to it are keyed by it — so it's generated once, here, and never
// derived from the title.
// What a section's entity chips are, named per section — the catalog only
// says a field is namespaced, not what kind of thing it is.
const ENTITY_GROUP_LABELS: Record<string, string> = {
  membership: "Tracks",
  availability: "Days",
  lunch: "Categories",
  event_preferences: "Questions",
};

// Shared by both kinds of row so a built-in and a custom section read as the
// same thing. The transparent bottom border matches EditableText's resting
// state (it reserves room for the underline it shows while editing), without
// which a custom row sits 1px taller than its neighbours.
const SECTION_LABEL_STYLE = {
  fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
} as const;

// Fixed so a row's height never depends on whether its name is an
// EditableText or a plain span.
const SECTION_ROW_HEIGHT = "38px";

// The name cell is pinned to one line's height. EditableText's input measures
// a little taller than its resting span, and in a centred row any growth
// re-centres the contents — so the text appears to jump up the moment you
// click it. A fixed box lets the input overflow imperceptibly instead of
// moving everything.
const SECTION_NAME_BOX: React.CSSProperties = {
  display: "flex", alignItems: "center", height: "20px",
};

function newCustomSectionId(): string {
  return `${CUSTOM_SECTION_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
}

function SortableSection({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        marginBottom: "8px",
        background: "var(--color-surface)",
      }}
    >
      {children(
        <span
          {...attributes}
          {...listeners}
          style={{ cursor: "grab", display: "flex", alignItems: "center", color: "var(--color-text-tertiary)" }}
          title="Drag to reorder"
        >
          <IconGripVertical size={14} />
        </span>
      )}
    </div>
  );
}

export function PanelSectionsModal({ tournamentId, onClose, onSaved }: PanelSectionsModalProps) {
  const { catalog, draft, setDraft, saving, error, save, loading } =
    useDisplayConfigDraft(tournamentId, MEMBERS_PANEL);
  const [expanded, setExpanded] = useState<string | null>(null);
  // The section created by the last "New section" press — it mounts expanded
  // and with its name in edit mode, since naming it is always the next step.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Hidden sections included — one still has to be reachable to turn back on.
  // Run through resolveSections even when a list is saved: that's what drops
  // an id that's no longer a section (an old built-in) and appends one that
  // has since been added, rather than showing whatever was saved verbatim.
  const sections: DisplayConfigSection[] = resolveSections(draft?.sections ?? null);

  const catalogById = new Map<string, DisplayConfigSectionCatalogItem>(
    (catalog?.sections ?? []).map((section) => [section.id, section]),
  );
  const assignedFields = new Set(
    sections.filter((s) => isCustomSection(s.id)).flatMap((s) => s.fields ?? []),
  );

  function update(next: DisplayConfigSection[]) {
    setDraft({ ...(draft ?? { hidden: [] }), sections: next });
  }

  function patch(id: string, changes: Partial<DisplayConfigSection>) {
    update(sections.map((section) => (section.id === id ? { ...section, ...changes } : section)));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.id === active.id);
    const to = sections.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    update(arrayMove(sections, from, to));
  }

  // A namespaced key ("track:3", "lunch_category:protein") names a real
  // entity, and the surface's `hidden` list already drops those server-side —
  // so it goes there rather than into the section's own hidden_fields, which
  // are the section's static pieces and have no server-side filter.
  const isEntityKey = (key: string) => key.includes(":");

  const hiddenItems = new Set(draft?.hidden ?? []);

  function fieldIsShown(section: DisplayConfigSection, fieldKey: string): boolean {
    return isEntityKey(fieldKey)
      ? !hiddenItems.has(fieldKey)
      : !(section.hidden_fields ?? []).includes(fieldKey);
  }

  function toggleField(section: DisplayConfigSection, fieldKey: string) {
    if (isEntityKey(fieldKey)) {
      const next = new Set(hiddenItems);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      setDraft({ ...(draft ?? { hidden: [] }), hidden: [...next], sections });
      return;
    }
    const hidden = new Set(section.hidden_fields ?? []);
    if (hidden.has(fieldKey)) hidden.delete(fieldKey);
    else hidden.add(fieldKey);
    patch(section.id, { hidden_fields: [...hidden] });
  }

  function toggleAssignment(section: DisplayConfigSection, fieldKey: string) {
    const assigned = new Set(section.fields ?? []);
    if (assigned.has(fieldKey)) {
      assigned.delete(fieldKey);
      patch(section.id, { fields: [...assigned] });
      return;
    }
    // A field belongs to at most one section — claiming it here releases it
    // from wherever it was, so it can never render twice.
    update(sections.map((candidate) => {
      if (candidate.id === section.id) return { ...candidate, fields: [...assigned, fieldKey] };
      if (!isCustomSection(candidate.id)) return candidate;
      return { ...candidate, fields: (candidate.fields ?? []).filter((f) => f !== fieldKey) };
    }));
  }

  function addCustomSection() {
    const id = newCustomSectionId();
    update([...sections, { id, title: "New section", hidden: false, fields: [] }]);
    setJustAdded(id);
    setExpanded(id);
  }

  return (
    <Modal title="Configure member panel" onClose={onClose} width={640}>
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "12px" }}>
          {error}
        </p>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {sections.map((section) => {
                const meta = catalogById.get(section.id);
                const custom = isCustomSection(section.id);
                const fields = meta?.fields ?? [];
                // Entity fields carry a namespaced key; static ones don't.
                const staticFields = fields.filter((field) => !field.key.includes(":"));
                const entityFields = fields.filter((field) => field.key.includes(":"));
                const expandable = custom || fields.length > 0;
                const isOpen = expanded === section.id;

                return (
                  <SortableSection key={section.id} id={section.id}>
                    {(handle) => (
                      <>
                        <div
                          onClick={expandable ? () => setExpanded(isOpen ? null : section.id) : undefined}
                          style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            padding: "0 10px", minHeight: SECTION_ROW_HEIGHT,
                            cursor: expandable ? "pointer" : "default",
                          }}
                        >
                          {/* The handle owns drag; the row owns expand. */}
                          <span onClick={(e) => e.stopPropagation()} style={{ display: "flex" }}>{handle}</span>
                          {expandable ? (
                            <span style={{ display: "flex", color: "var(--color-text-tertiary)" }}>
                              {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                            </span>
                          ) : <span style={{ width: "12px" }} />}

                          {custom ? (
                            // Click-to-edit rather than a permanent field:
                            // the row is clickable to expand, and a full input
                            // sitting in it invites a click that does nothing.
                            <span onClick={(e) => e.stopPropagation()} style={SECTION_NAME_BOX}>
                              <EditableText
                                value={section.title ?? DEFAULT_CUSTOM_SECTION_TITLE}
                                onSave={(title) => patch(section.id, { title })}
                                startEditing={section.id === justAdded}
                                textStyle={SECTION_LABEL_STYLE}
                                title="Click to rename"
                              />
                            </span>
                          ) : (
                            <span style={{
                              ...SECTION_LABEL_STYLE,
                              ...SECTION_NAME_BOX,
                              color: "var(--color-text-primary)",
                              borderBottom: "1px solid transparent",
                            }}>
                              {meta?.label ?? section.id}
                            </span>
                          )}

                          {/* Pushes the controls to the right edge so every
                              row's toggle lines up, whether its name is a
                              full-width Input or a short label. */}
                          <span style={{ flex: 1 }} />

                          {custom && (
                            <Button
                              type="button" variant="secondary" size="sm" iconOnly title="Delete section"
                              onClick={(e) => {
                                e.stopPropagation();
                                update(sections.filter((s) => s.id !== section.id));
                              }}
                            >
                              <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
                            </Button>
                          )}
                          <span onClick={(e) => e.stopPropagation()} style={{ display: "flex" }}>
                            <Toggle
                              checked={!section.hidden}
                              onChange={() => patch(section.id, { hidden: !section.hidden })}
                            />
                          </span>
                        </div>

                        {/* 0fr -> 1fr animates to the content's natural
                            height, which a max-height transition can't do
                            without hardcoding a guess per section. */}
                        <div style={{
                          display: "grid",
                          gridTemplateRows: isOpen ? "1fr" : "0fr",
                          transition: "grid-template-rows 180ms ease",
                        }}>
                          <div style={{ overflow: "hidden" }}>
                          <div style={{ padding: "0 10px 10px 44px", display: "flex", flexDirection: "column", gap: "6px" }}>
                            {/* The section's own static fields. */}
                            {staticFields.map((field) => (
                              <label key={field.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                                <Checkbox
                                  checked={fieldIsShown(section, field.key)}
                                  onChange={() => toggleField(section, field.key)}
                                />
                                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{field.label}</span>
                              </label>
                            ))}

                            {/* Tracks as chips: a tournament can have a dozen,
                                and a chip row reads as "these are shown" far
                                faster than a column of ticked boxes. */}
                            {entityFields.length > 0 && (
                              <span style={{
                                fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                                letterSpacing: "0.06em", textTransform: "uppercase",
                                color: "var(--color-text-tertiary)",
                                marginTop: staticFields.length > 0 ? "6px" : 0,
                              }}>
                                {ENTITY_GROUP_LABELS[section.id] ?? "Items"}
                              </span>
                            )}
                            {entityFields.length > 0 && (
                              <ChipInput
                                value={entityFields.filter((f) => fieldIsShown(section, f.key)).map((f) => f.label)}
                                onChange={(labels) => {
                                  const removed = entityFields.find(
                                    (f) => fieldIsShown(section, f.key) && !labels.includes(f.label),
                                  );
                                  if (removed) toggleField(section, removed.key);
                                }}
                                variant="transparent"
                                size="sm"
                                disableInput
                                fullWidth
                                addButton={
                                  <Popover
                                    trigger={
                                      <Button type="button" variant="secondary" size="sm" iconOnly title="Edit visible items" style={{ padding: 0, flexShrink: 0 }}>
                                        <IconPlus size={13} />
                                      </Button>
                                    }
                                    items={entityFields}
                                    getKey={(field) => field.key}
                                    renderLabel={(field) => field.label}
                                    checklist
                                    isSelected={(field) => fieldIsShown(section, field.key)}
                                    onSelect={(field) => toggleField(section, field.key)}
                                    emptyMessage="Nothing to configure"
                                  />
                                }
                              />
                            )}

                            {/* Custom: which answers this section collects. A
                                field already claimed elsewhere still appears,
                                so moving one between sections is a single
                                click rather than an unassign-then-assign. */}
                            {custom && (catalog?.custom_fields ?? []).map((field) => {
                              const mine = (section.fields ?? []).includes(field.key);
                              const takenElsewhere = !mine && assignedFields.has(field.key);
                              return (
                                <label key={field.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                                  <Checkbox checked={mine} onChange={() => toggleAssignment(section, field.key)} />
                                  <span style={{
                                    fontFamily: "var(--font-sans)", fontSize: "13px",
                                    color: takenElsewhere ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
                                  }}>
                                    {field.label}{takenElsewhere ? " — in another section" : ""}
                                  </span>
                                </label>
                              );
                            })}

                            {custom && (catalog?.custom_fields ?? []).length === 0 && (
                              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                                No custom form fields yet.
                              </span>
                            )}
                          </div>
                          </div>
                        </div>
                      </>
                    )}
                  </SortableSection>
                );
              })}
            </SortableContext>
          </DndContext>

          <Button type="button" variant="secondary" size="sm" onClick={addCustomSection}>
            <IconPlus size={13} /> New section
          </Button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => save(onSaved, onClose)} disabled={saving || !draft}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
