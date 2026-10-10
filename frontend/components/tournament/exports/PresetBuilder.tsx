"use client";

import { useState } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DisplayConfigSort, ExportColumnMode, ExportPresetColumn, ExportRowType } from "@/lib/api";
import type { ExportColumn, ExportColumnGroup } from "@/lib/exports/columns";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { Input } from "@/components/ui/Input";
import { SortButton } from "@/components/ui/SortButton";
import { SortModal } from "@/components/ui/SortModal";
import { Switch } from "@/components/ui/Switch";
import { IconGripVertical, IconX } from "@/components/ui/Icons";
import type { SortRule } from "@/lib/sorting";

/** A custom preset being edited. row_type starts null: there's no default,
 *  the TD picks one before columns are offered. */
export interface BuilderDraft {
  name:           string;
  row_type:       ExportRowType | null;
  columns:        ExportPresetColumn[];
  sorts:          DisplayConfigSort[];
  include_header: boolean;
}

const ROW_TYPE_OPTIONS = [
  { value: "member",     label: "Per member",     description: "One row per person" },
  { value: "event",      label: "Per event",      description: "One row per person and event" },
  { value: "assignment", label: "Per assignment", description: "One row per assignment" },
];

const MODE_OPTIONS = [
  { value: "names", label: "Names" },
  { value: "times", label: "Times" },
];

// "" is the dropdown's "every track"; a track id otherwise.
const ALL_TRACKS = "";

interface PresetBuilderProps {
  draft:     BuilderDraft;
  onChange:  (patch: Partial<BuilderDraft>) => void;
  // Columns offered for the draft's row type and the picked track.
  available: ExportColumnGroup[];
  // Resolves a selected column for its header and whether it takes a mode.
  resolve:   (key: string) => ExportColumn | null;
  tracks:    { id: number; name: string }[];
  trackId:   number | null;
  onTrackChange: (trackId: number | null) => void;
  // Lets the parent ignore Escape while the sort modal is up.
  onChildModal: (open: boolean) => void;
}

export function PresetBuilder({
  draft, onChange, available, resolve, tracks, trackId, onTrackChange, onChildModal,
}: PresetBuilderProps) {
  const [showSort, setShowSort] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const selected = new Set(draft.columns.map((c) => c.key));

  function openSort(open: boolean) {
    setShowSort(open);
    onChildModal(open);
  }

  function changeRowType(rowType: ExportRowType) {
    // Columns that don't apply to the new row type go, and the sorts on them.
    const columns = draft.columns.filter((c) => resolve(c.key)?.rowTypes.includes(rowType));
    const keys = new Set(columns.map((c) => c.key));
    onChange({ row_type: rowType, columns, sorts: draft.sorts.filter((s) => keys.has(s.field)) });
  }

  function removeColumn(key: string) {
    onChange({
      columns: draft.columns.filter((c) => c.key !== key),
      sorts: draft.sorts.filter((s) => s.field !== key),
    });
  }

  function setMode(key: string, mode: ExportColumnMode) {
    onChange({ columns: draft.columns.map((c) => (c.key === key ? { ...c, mode } : c)) });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = draft.columns.findIndex((c) => c.key === active.id);
    const to = draft.columns.findIndex((c) => c.key === over.id);
    onChange({ columns: arrayMove(draft.columns, from, to) });
  }

  const addOptions = available
    .map((group) => ({
      group: group.title,
      options: group.columns.filter((c) => !selected.has(c.key)).map((c) => ({ value: c.key, label: c.header })),
    }))
    .filter((group) => group.options.length > 0);

  const sortFields = draft.columns
    .map((c) => resolve(c.key))
    .filter((c): c is ExportColumn => c !== null)
    .map((c) => ({ value: c.key, label: c.header }));

  return (
    <div>
      <SettingsSection title="Export">
        <SettingsRow label="Name">
          <Input fullWidth value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Lunch counts" />
        </SettingsRow>
        <SettingsRow label="Rows" helper="What one row of the export is.">
          <ButtonGroup
            options={ROW_TYPE_OPTIONS}
            value={draft.row_type ?? ""}
            onChange={(value) => changeRowType(value as ExportRowType)}
          />
        </SettingsRow>
        {tracks.length > 1 && (
          <SettingsRow label="Track" helper="Narrows the columns offered and the assignments exported. Not saved." last>
            <Dropdown
              fullWidth
              value={trackId === null ? ALL_TRACKS : String(trackId)}
              onChange={(value) => onTrackChange(value === ALL_TRACKS ? null : Number(value))}
              options={[{ value: ALL_TRACKS, label: "All tracks" }, ...tracks.map((t) => ({ value: String(t.id), label: t.name }))]}
            />
          </SettingsRow>
        )}
      </SettingsSection>

      {draft.row_type && (
        <SettingsSection title="Columns">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 16px" }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={draft.columns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                {draft.columns.map((column) => (
                  <ColumnRow
                    key={column.key}
                    column={column}
                    resolved={resolve(column.key)}
                    onMode={(mode) => setMode(column.key, mode)}
                    onRemove={() => removeColumn(column.key)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <Dropdown
              fullWidth
              searchable
              value=""
              placeholder="Add column…"
              options={addOptions}
              emptyMessage="Every column is already added"
              onChange={(key) => key && onChange({ columns: [...draft.columns, { key }] })}
            />
          </div>
          <SettingsRow label="Sort" contentStyle={{ display: "flex", justifyContent: "flex-end" }}>
            <SortButton
              active={draft.sorts.length > 0}
              onOpen={() => openSort(true)}
              onReset={() => onChange({ sorts: [] })}
            />
          </SettingsRow>
          <SettingsRow label="Header row" helper="Column names as the first row." last contentStyle={{ display: "flex", justifyContent: "flex-end" }}>
            <Switch checked={draft.include_header} onChange={(checked) => onChange({ include_header: checked })} />
          </SettingsRow>
        </SettingsSection>
      )}

      {showSort && (
        <SortModal
          title="Sort export"
          fields={sortFields}
          rules={draft.sorts as SortRule[]}
          defaults={[]}
          tiebreakLabel="roster order"
          onApply={(rules) => onChange({ sorts: rules.map((r) => ({ field: r.field, direction: r.direction })) })}
          onClose={() => openSort(false)}
        />
      )}
    </div>
  );
}

interface ColumnRowProps {
  column:   ExportPresetColumn;
  // Null when the column no longer resolves (a deleted track or field).
  resolved: ExportColumn | null;
  onMode:   (mode: ExportColumnMode) => void;
  onRemove: () => void;
}

function ColumnRow({ column, resolved, onMode, onRemove }: ColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key });
  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate, not Transform: rows differ in height when one has a mode toggle.
        transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
        display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px",
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg)",
      }}
    >
      <span {...attributes} {...listeners} style={{ display: "flex", cursor: "grab", color: "var(--color-text-tertiary)" }}>
        <IconGripVertical size={14} />
      </span>
      <span style={{
        flex: 1, minWidth: 0, fontFamily: "var(--font-sans)", fontSize: "13px",
        color: resolved ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {resolved ? resolved.header : `${column.key} (no longer available — skipped)`}
      </span>
      {resolved?.hasModes && (
        <ButtonGroup size="sm" options={MODE_OPTIONS} value={column.mode ?? "names"} onChange={(v) => onMode(v as ExportColumnMode)} />
      )}
      <Button type="button" variant="ghost" size="xs" iconOnly title="Remove column" onClick={onRemove}>
        <IconX size={12} />
      </Button>
    </div>
  );
}
