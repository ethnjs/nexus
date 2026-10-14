"use client";

import { PanelField } from "@/components/tournament/exports/PanelField";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconX } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import type {
  DisplayConfigSort,
  ExportColumnMode,
  ExportOutput,
  ExportPresetColumn,
  ExportRowType,
} from "@/lib/api";
import { columnMode, type ExportColumn, type ExportColumnGroup } from "@/lib/exports/columns";

/** A custom preset being edited. row_type starts null: there's no default,
 *  the TD picks one before columns are offered. */
export interface BuilderDraft {
  name: string;
  row_type: ExportRowType | null;
  columns: ExportPresetColumn[];
  sorts: DisplayConfigSort[];
  include_header: boolean;
  output_type: ExportOutput;
}

const ROW_TYPE_OPTIONS = [
  { value: "member", label: "Per member", description: "One row per person" },
  { value: "event", label: "Per event", description: "One row per event" },
];

// What identifies a row — added up front when the row type is picked.
// A member row's are removable (an email list doesn't want names); an event
// row is meaningless without its event and who's on it.
const DEFAULT_COLUMNS: Record<ExportRowType, string[]> = {
  member: ["first_name", "last_name"],
  event: ["event", "members"],
};
// UI-only: the backend doesn't enforce it.
const FIXED_COLUMNS: Record<ExportRowType, ReadonlySet<string>> = {
  member: new Set(),
  event: new Set(["event", "members"]),
};

const OUTPUT_OPTIONS = [
  { value: "copy", label: "Copy" },
  { value: "txt", label: "TXT" },
  { value: "csv", label: "CSV" },
];

// "" is the dropdown's "every track"; a track id otherwise.
const ALL_TRACKS = "";

interface PresetBuilderProps {
  draft: BuilderDraft;
  onChange: (patch: Partial<BuilderDraft>) => void;
  // Columns offered for the draft's row type and the picked track.
  available: ExportColumnGroup[];
  // Resolves a selected column for its header and whether it takes a mode.
  resolve: (key: string) => ExportColumn | null;
  tracks: { id: number; name: string }[];
  trackId: number | null;
  onTrackChange: (trackId: number | null) => void;
}

export function PresetBuilder({
  draft,
  onChange,
  available,
  resolve,
  tracks,
  trackId,
  onTrackChange,
}: PresetBuilderProps) {
  const selected = new Set(draft.columns.map((c) => c.key));

  function changeRowType(rowType: ExportRowType) {
    if (rowType === draft.row_type) return;
    // Columns that don't apply to the new row type go, and the sorts on them.
    const kept = draft.columns.filter((c) => resolve(c.key)?.rowTypes.includes(rowType));
    const keptKeys = new Set(kept.map((c) => c.key));
    const defaults = DEFAULT_COLUMNS[rowType]
      .filter((key) => !keptKeys.has(key))
      .map((key) => ({ key }));
    onChange({
      row_type: rowType,
      columns: [...defaults, ...kept],
      sorts: draft.sorts.filter((s) => keptKeys.has(s.field)),
    });
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

  const addOptions = available
    .map((group) => ({
      group: group.title,
      options: group.columns
        .filter((c) => !selected.has(c.key))
        .map((c) => ({ value: c.key, label: c.header })),
    }))
    .filter((group) => group.options.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PanelField label="Name">
        <Input
          fullWidth
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Lunch counts"
        />
      </PanelField>
      <PanelField label="Rows" helper="What one row of the export is.">
        <ButtonGroup
          options={ROW_TYPE_OPTIONS}
          value={draft.row_type ?? ""}
          onChange={(value) => changeRowType(value as ExportRowType)}
        />
      </PanelField>
      {tracks.length > 1 && (
        <PanelField
          label="Track"
          helper="Narrows the columns offered and the assignments exported. Not saved."
        >
          <Dropdown
            fullWidth
            value={trackId === null ? ALL_TRACKS : String(trackId)}
            onChange={(value) => onTrackChange(value === ALL_TRACKS ? null : Number(value))}
            options={[
              { value: ALL_TRACKS, label: "All tracks" },
              ...tracks.map((t) => ({ value: String(t.id), label: t.name })),
            ]}
          />
        </PanelField>
      )}

      {draft.row_type && (
        <>
          <PanelField label="Columns" helper="In the order added.">
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {draft.columns.map((column) => (
                <ColumnRow
                  key={column.key}
                  column={column}
                  resolved={resolve(column.key)}
                  fixed={FIXED_COLUMNS[draft.row_type!].has(column.key)}
                  onMode={(mode) => setMode(column.key, mode)}
                  onRemove={() => removeColumn(column.key)}
                />
              ))}
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
          </PanelField>
          <PanelField label="Header row" helper="Column names as the first row." inline>
            <Switch
              checked={draft.include_header}
              onChange={(checked) => onChange({ include_header: checked })}
            />
          </PanelField>
          <PanelField label="Export type">
            <ButtonGroup
              options={OUTPUT_OPTIONS}
              value={draft.output_type}
              onChange={(value) => onChange({ output_type: value as ExportOutput })}
            />
          </PanelField>
        </>
      )}
    </div>
  );
}

interface ColumnRowProps {
  column: ExportPresetColumn;
  // Null when the column no longer resolves (a deleted track or field).
  resolved: ExportColumn | null;
  // Can't be removed for this row type.
  fixed: boolean;
  onMode: (mode: ExportColumnMode) => void;
  onRemove: () => void;
}

function ColumnRow({ column, resolved, fixed, onMode, onRemove }: ColumnRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        padding: "6px 6px 6px 10px",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg)",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: resolved ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {resolved ? resolved.header : `${column.key} (no longer available — skipped)`}
      </span>
      {resolved && resolved.modes.length > 0 && (
        <ButtonGroup
          size="sm"
          options={[...resolved.modes]}
          value={columnMode(resolved, column.mode)}
          onChange={(v) => onMode(v as ExportColumnMode)}
        />
      )}
      {!fixed && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          iconOnly
          title="Remove column"
          onClick={onRemove}
        >
          <IconX size={12} />
        </Button>
      )}
    </div>
  );
}
