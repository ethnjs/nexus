"use client";

import { useRef, useState, useCallback } from "react";
import type { MappingRow } from "@/lib/importMappings";

// ─── Constants ────────────────────────────────────────────────────────────────

export const KNOWN_FIELDS_LABELS: Record<string, string> = {
  "__ignore__":          "Ignore",
  "first_name":          "First Name",
  "last_name":           "Last Name",
  "email":               "Email",
  "phone":               "Phone",
  "shirt_size":          "Shirt Size",
  "dietary_restriction": "Dietary Restriction",
  "university":          "University",
  "major":               "Major",
  "employer":            "Employer",
  "role_preference":     "Role Preference",
  "event_preference":    "Event Preference",
  "availability":        "Availability",
  "lunch_order":         "Lunch Order",
  "notes":               "Notes",
  "extra_data":          "Extra Data",
};

export const TYPE_LABELS: Record<string, string> = {
  string:          "Text",
  ignore:          "Ignore",
  boolean:         "Yes/No",
  integer:         "Number",
  multi_select:    "Multi-select",
  matrix_row:      "Availability Row",
  category_events: "Category Events",
};

// ─── Row state ────────────────────────────────────────────────────────────────

/**
 * "same"    — matches the baseline (suggestion or original saved value)
 * "changed" — user or import has diverged from baseline
 * "new"     — header exists in live sheet but not in saved config (edit page only)
 * "removed" — header exists in saved config but not in live sheet (edit page only)
 */
export type RowState = "same" | "changed" | "new" | "removed";

/**
 * Extended MappingRow with diff metadata.
 *
 * `baseline` is the frozen reference used to compute `state` and to render the
 * hover diff tooltip. On the new-sheet page it's the server suggestion. On the
 * edit page it's the previously saved config value.
 *
 * `importedValue` captures the value at the moment an import file was applied,
 * so the tooltip can show baseline → import → edit when all three differ.
 */
export interface RichMappingRow extends MappingRow {
  state:          RowState;
  baseline:       MappingRow;    // server suggestion OR saved config value
  importedValue?: MappingRow;    // snapshot taken when import was applied
}

const ROW_COLORS: Record<RowState, { bg: string; border: string } | null> = {
  same:    null,
  changed: { bg: "#FEFCE8", border: "#FDE047" },
  new:     { bg: "#F0FDF4", border: "#86EFAC" },
  removed: { bg: "#FFF5F5", border: "#FCA5A5" },
};

const BADGE_STYLES: Record<RowState, { color: string; bg: string; label: string } | null> = {
  same:    null,
  changed: { color: "#854D0E", bg: "#FEF9C3", label: "Edited"  },
  new:     { color: "#16A34A", bg: "#DCFCE7", label: "New"     },
  removed: { color: "#DC2626", bg: "#FEE2E2", label: "Removed" },
};

// ─── Shared select style ──────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  height: "36px", padding: "0 10px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-sans)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", cursor: "pointer",
};

// ─── Diff tooltip ─────────────────────────────────────────────────────────────

interface DiffLine {
  label: string;
  from:  string;
  to:    string;
}

const FIELD_DEFS: { label: string; key: keyof MappingRow; fmt?: (v: string) => string }[] = [
  { label: "Field",     key: "field",     fmt: (v) => KNOWN_FIELDS_LABELS[v] ?? v },
  { label: "Type",      key: "type",      fmt: (v) => TYPE_LABELS[v] ?? v },
  { label: "Row Key",   key: "row_key" },
  { label: "Extra Key", key: "extra_key" },
];

/** Diff lines where values changed between two MappingRows. */
function diffBetween(a: MappingRow, b: MappingRow): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const { label, key, fmt } of FIELD_DEFS) {
    const from = String(a[key] ?? "");
    const to   = String(b[key] ?? "");
    if (from === to) continue;
    const fmtVal = fmt ?? ((v: string) => v || "—");
    lines.push({ label, from: fmtVal(from), to: fmtVal(to) });
  }
  return lines;
}

function DiffSection({ lines, last }: { lines: DiffLine[]; last: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px", ...(last ? {} : { paddingBottom: "10px" }) }}>
      {lines.map(({ label, from, to }) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
            color: "var(--color-text-secondary)", minWidth: "64px", flexShrink: 0,
          }}>
            {label}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            {from}
          </span>
          <span style={{ color: "var(--color-text-tertiary)", fontSize: "10px" }}>→</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#854D0E", fontWeight: 600 }}>
            {to}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffTooltip({
  row,
  anchorRect,
  baselineLabel,
  onMouseEnter,
  onMouseLeave,
}: {
  row:           RichMappingRow;
  anchorRect:    DOMRect;
  baselineLabel: string;
  onMouseEnter:  () => void;
  onMouseLeave:  () => void;
}) {
  const imp = row.importedValue;

  // Section 2 only appears if the user edited after an import changed the row —
  // i.e. current values differ from what the import set.
  const hasPostImportEdit = imp !== undefined && FIELD_DEFS.some(({ key }) =>
    String(imp[key] ?? "") !== String(row[key] ?? "")
  );

  // Section 1: baseline → importedValue  (or baseline → current when no import)
  const section1Lines = diffBetween(row.baseline, imp ?? (row as MappingRow));
  // Section 2: importedValue → current  (only when user edited after import)
  const section2Lines = hasPostImportEdit && imp ? diffBetween(imp, row as MappingRow) : [];

  if (section1Lines.length === 0 && section2Lines.length === 0) return null;

  const top  = anchorRect.bottom + 6;
  const left = Math.max(8, anchorRect.left);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position:     "fixed",
        top,
        left,
        zIndex:       9999,
        background:   "var(--color-surface)",
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow:    "var(--shadow-lg)",
        padding:      "10px 14px",
        minWidth:     "220px",
      }}
    >
      {section1Lines.length > 0 && (
        <>
          <p style={{
            fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.07em",
            color: "var(--color-text-tertiary)", marginBottom: "8px",
          }}>
            Changes from {baselineLabel}
          </p>
          <DiffSection lines={section1Lines} last={section2Lines.length === 0} />
        </>
      )}
      {section2Lines.length > 0 && (
        <>
          <div style={{ borderTop: "1px solid var(--color-border)", marginBottom: "10px" }} />
          <p style={{
            fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.07em",
            color: "var(--color-text-tertiary)", marginBottom: "8px",
          }}>
            Changes from import
          </p>
          <DiffSection lines={section2Lines} last={true} />
        </>
      )}
    </div>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────────

function MappingRow({
  row,
  knownFields,
  validTypes,
  onChange,
  isLast,
  viewOnly,
  baselineLabel,
}: {
  row:           RichMappingRow;
  knownFields:   string[];
  validTypes:    string[];
  onChange?:     (patch: Partial<MappingRow>) => void;
  isLast:        boolean;
  viewOnly:      boolean;
  baselineLabel: string;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [anchorRect, setAnchorRect]         = useState<DOMRect | null>(null);
  const rowRef      = useRef<HTMLDivElement>(null);
  // Track whether the mouse is over the row or the tooltip so we don't
  // dismiss prematurely when the cursor moves between them.
  const overRow     = useRef(false);
  const overTooltip = useRef(false);

  const isIgnored     = row.type === "ignore" || row.field === "__ignore__";
  const isRemoved     = row.state === "removed";
  const needsRowKey   = row.type === "matrix_row";
  const needsExtraKey = row.field === "extra_data";
  const colors        = ROW_COLORS[row.state];
  const badge         = BADGE_STYLES[row.state];
  const showDiff      = row.state === "changed";

  const rowBg      = colors ? colors.bg : "var(--color-surface)";
  const borderLeft = colors ? `3px solid ${colors.border}` : "3px solid transparent";
  const opacity    = (isIgnored && !isRemoved) ? (viewOnly ? 0.45 : 0.4) : isRemoved ? 0.5 : 1;

  function handleFieldChange(field: string) {
    if (!onChange) return;
    let type = row.type;
    if (field === "__ignore__")                                           type = "ignore";
    else if (field === "availability")                                    type = "matrix_row";
    else if (field === "role_preference" || field === "event_preference") type = "multi_select";
    else if (type === "ignore")                                           type = "string";
    onChange({ field, type, extra_key: field === "extra_data" ? row.extra_key : "" });
  }

  function handleTypeChange(type: string) {
    if (!onChange) return;
    onChange({ type, ...(type === "ignore" ? { field: "__ignore__" } : {}) });
  }

  // Small delay so moving from the row onto the tooltip doesn't cause a flicker.
  const tryHide = useCallback(() => {
    setTimeout(() => {
      if (!overRow.current && !overTooltip.current) {
        setTooltipVisible(false);
      }
    }, 80);
  }, []);

  function handleRowMouseEnter() {
    if (!showDiff || !rowRef.current) return;
    overRow.current = true;
    setAnchorRect(rowRef.current.getBoundingClientRect());
    setTooltipVisible(true);
  }

  function handleRowMouseLeave() {
    overRow.current = false;
    tryHide();
  }

  function handleTooltipMouseEnter() {
    overTooltip.current = true;
  }

  function handleTooltipMouseLeave() {
    overTooltip.current = false;
    tryHide();
  }

  // ── Extra key / row key cell ──────────────────────────────────────────────

  function renderKeyCell() {
    if (isRemoved) {
      return (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          excluded from save
        </span>
      );
    }
    if (needsRowKey) {
      if (viewOnly) {
        return (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
            {row.row_key || "—"}
          </span>
        );
      }
      return (
        <input
          style={{ ...selectStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          placeholder="e.g. 8:00 AM - 10:00 AM"
          value={row.row_key}
          onChange={(e) => onChange?.({ row_key: e.target.value })}
        />
      );
    }
    if (needsExtraKey) {
      if (viewOnly) {
        return (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
            {row.extra_key || "—"}
          </span>
        );
      }
      return (
        <input
          style={{ ...selectStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          placeholder="extra_key name"
          value={row.extra_key}
          onChange={(e) => onChange?.({ extra_key: e.target.value })}
        />
      );
    }
    return (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>—</span>
    );
  }

  return (
    <>
      <div
        ref={rowRef}
        onMouseEnter={handleRowMouseEnter}
        onMouseLeave={handleRowMouseLeave}
        style={{
          display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr",
          padding: "10px 14px", alignItems: "center", gap: "8px",
          background: rowBg,
          borderBottom: isLast ? "none" : "1px solid var(--color-border)",
          borderLeft,
        }}
      >
        {/* ── Column 1: header name + badge ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "12px",
            color: "var(--color-text-primary)", opacity,
            wordBreak: "break-word", lineHeight: 1.4,
            textDecoration: isRemoved ? "line-through" : "none",
          }}>
            {row.header}
          </span>
          {badge && (
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "9px", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.06em",
              color: badge.color, background: badge.bg,
              padding: "1px 5px", borderRadius: "3px", flexShrink: 0,
            }}>
              {badge.label}
            </span>
          )}
        </div>

        {/* ── Column 2: field ── */}
        {viewOnly ? (
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "12px",
            color: isIgnored ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
          }}>
            {isIgnored ? "—" : (KNOWN_FIELDS_LABELS[row.field] ?? row.field)}
          </span>
        ) : (
          <select
            value={row.field}
            onChange={(e) => handleFieldChange(e.target.value)}
            disabled={isRemoved}
            style={{ ...selectStyle, width: "100%", opacity }}
          >
            {knownFields.map((f) => (
              <option key={f} value={f}>{KNOWN_FIELDS_LABELS[f] ?? f}</option>
            ))}
          </select>
        )}

        {/* ── Column 3: type ── */}
        {viewOnly ? (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {TYPE_LABELS[row.type] ?? row.type}
          </span>
        ) : (
          <select
            value={row.type}
            onChange={(e) => handleTypeChange(e.target.value)}
            disabled={isRemoved || row.field === "__ignore__"}
            style={{ ...selectStyle, width: "100%", opacity }}
          >
            {validTypes.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
        )}

        {/* ── Column 4: extra / row key ── */}
        <div style={{ opacity }}>
          {renderKeyCell()}
        </div>
      </div>

      {/* Tooltip — fixed position, stays open when mouse moves from row onto it */}
      {tooltipVisible && showDiff && anchorRect && (
        <DiffTooltip
          row={row}
          anchorRect={anchorRect}
          baselineLabel={baselineLabel}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        />
      )}
    </>
  );
}

// ─── Table wrapper ────────────────────────────────────────────────────────────

export interface SheetConfigMappingTableProps {
  rows:        RichMappingRow[];
  knownFields: string[];
  validTypes:  string[];
  /** Pass undefined / omit for view-only mode (no selects or inputs rendered) */
  onChangeRow?: (idx: number, patch: Partial<MappingRow>) => void;
  /** Explicitly forces read-only mode even if onChangeRow is provided */
  viewOnly?:   boolean;
  /**
   * Label used in the diff tooltip header: "Changes from <baselineLabel>"
   * Defaults to "suggestion" (new-sheet page).
   * Pass "saved" for the edit page.
   */
  baselineLabel?: string;
}

export function SheetConfigMappingTable({
  rows,
  knownFields,
  validTypes,
  onChangeRow,
  viewOnly = false,
  baselineLabel = "suggestion",
}: SheetConfigMappingTableProps) {
  const isViewOnly = viewOnly || !onChangeRow;

  if (rows.length === 0) {
    return (
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
        No columns mapped yet.
      </p>
    );
  }

  return (
    <div style={{ position: "relative", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "visible" }}>
      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr",
        alignItems: "start",
        padding: "8px 14px",
        background: "var(--color-bg)",
        borderBottom: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md) var(--radius-md) 0 0",
        overflow: "hidden",
      }}>
        {["Sheet Column", "Field", "Type", "Extra Key / Row Key"].map((h) => (
          <span key={h} style={{
            fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.07em",
            color: "var(--color-text-tertiary)",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows — overflow hidden clips row background colors to the border-radius */}
      <div style={{ borderRadius: "0 0 var(--radius-md) var(--radius-md)", overflow: "hidden" }}>
        {rows.map((row, idx) => (
          <MappingRow
            key={row.header}
            row={row}
            knownFields={knownFields}
            validTypes={validTypes}
            onChange={isViewOnly ? undefined : (patch) => onChangeRow!(idx, patch)}
            isLast={idx === rows.length - 1}
            viewOnly={isViewOnly}
            baselineLabel={baselineLabel}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Helper: build a RichMappingRow ──────────────────────────────────────────

/**
 * Construct a RichMappingRow and compute its state relative to `baseline`.
 * Call this whenever a row's values change (user edit or import apply).
 */
export function makeRichRow(
  values:         MappingRow,
  baseline:       MappingRow,
  forcedState?:   "new" | "removed",
  importedValue?: MappingRow,
): RichMappingRow {
  let state: RowState = forcedState ?? "same";
  if (!forcedState) {
    const changed =
      values.field     !== baseline.field     ||
      values.type      !== baseline.type      ||
      values.row_key   !== baseline.row_key   ||
      values.extra_key !== baseline.extra_key;
    state = changed ? "changed" : "same";
  }
  return { ...values, state, baseline, importedValue };
}