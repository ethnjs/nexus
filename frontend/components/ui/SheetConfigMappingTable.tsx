"use client";

import { useRef, useState, useCallback } from "react";
import type { MappingRow } from "@/lib/importMappings";
import type { ParseRule, ParseRuleCondition, ParseRuleAction, ValidationIssue } from "@/lib/api";
import { mappingRowsEqual } from "@/lib/importMappings";

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
  string:       "Text",
  ignore:       "Ignore",
  boolean:      "Yes/No",
  integer:      "Number",
  multi_select: "Multi-select",
  matrix_row:   "Matrix Row",
};

const CONDITION_LABELS: Record<string, string> = {
  always:      "Always",
  contains:    "Contains",
  equals:      "Equals",
  starts_with: "Starts with",
  ends_with:   "Ends with",
  regex:       "Regex",
};

const ACTION_LABELS: Record<string, string> = {
  set:               "Set to",
  replace:           "Replace with",
  prepend:           "Prepend",
  append:            "Append",
  discard:           "Discard",
  parse_availability:"Parse availability",
};

/** Actions that don't need a value input */
const VALUELESS_ACTIONS = new Set<ParseRuleAction>(["discard", "parse_availability"]);

// ─── Row state ────────────────────────────────────────────────────────────────

export type RowState = "same" | "changed" | "new" | "removed";

export interface RichMappingRow extends MappingRow {
  state:          RowState;
  baseline:       MappingRow;
  importedValue?: MappingRow;
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

// ─── Shared input style ───────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  height: "36px", padding: "0 10px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-sans)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  cursor: "text",
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
  { label: "Delimiter", key: "delimiter" },
];

function diffBetween(a: MappingRow, b: MappingRow): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const { label, key, fmt } of FIELD_DEFS) {
    const from = String(a[key] ?? "");
    const to   = String(b[key] ?? "");
    if (from === to) continue;
    const fmtVal = fmt ?? ((v: string) => v || "—");
    lines.push({ label, from: fmtVal(from), to: fmtVal(to) });
  }
  // Summarise rule count diff if rules changed
  const aRules = Array.isArray(a.rules) ? a.rules.length : 0;
  const bRules = Array.isArray(b.rules) ? b.rules.length : 0;
  if (aRules !== bRules) {
    lines.push({ label: "Rules", from: String(aRules), to: String(bRules) });
  }
  return lines;
}

function DiffSection({ lines, last }: { lines: DiffLine[]; last: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px", ...(last ? {} : { paddingBottom: "10px" }) }}>
      {lines.map(({ label, from, to }) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", minWidth: "64px", flexShrink: 0 }}>
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
  row, anchorRect, baselineLabel, onMouseEnter, onMouseLeave,
}: {
  row:           RichMappingRow;
  anchorRect:    DOMRect;
  baselineLabel: string;
  onMouseEnter:  () => void;
  onMouseLeave:  () => void;
}) {
  const imp = row.importedValue;
  const hasPostImportEdit = imp !== undefined && !mappingRowsEqual(imp, row as MappingRow);
  const section1Lines = diffBetween(row.baseline, imp ?? (row as MappingRow));
  const section2Lines = hasPostImportEdit && imp ? diffBetween(imp, row as MappingRow) : [];
  if (section1Lines.length === 0 && section2Lines.length === 0) return null;

  const top  = anchorRect.bottom + 6;
  const left = Math.max(8, anchorRect.left);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed", top, left, zIndex: 9999,
        background: "var(--color-surface)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
        padding: "10px 14px", minWidth: "220px",
      }}
    >
      {section1Lines.length > 0 && (
        <>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
            Changes from {baselineLabel}
          </p>
          <DiffSection lines={section1Lines} last={section2Lines.length === 0} />
        </>
      )}
      {section2Lines.length > 0 && (
        <>
          <div style={{ borderTop: "1px solid var(--color-border)", marginBottom: "10px" }} />
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
            Changes from import
          </p>
          <DiffSection lines={section2Lines} last={true} />
        </>
      )}
    </div>
  );
}

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease", flexShrink: 0 }}
    >
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Rule editor row ──────────────────────────────────────────────────────────

function RuleRow({
  rule,
  index,
  total,
  validConditions,
  validActions,
  onChange,
  onMove,
  onRemove,
  error,
  warning,
  isRemoved,
}: {
  rule:            ParseRule;
  index:           number;
  total:           number;
  validConditions: string[];
  validActions:    string[];
  onChange:        (patch: Partial<ParseRule>) => void;
  onMove:          (dir: -1 | 1) => void;
  onRemove:        () => void;
  error?:          string;
  warning?:        string;
  isRemoved:       boolean;
}) {
  const showMatch = rule.condition !== "always";
  const showValue = !VALUELESS_ACTIONS.has(rule.action as ParseRuleAction);

  const bg      = error   ? "#FFF5F5"
                : warning ? "#FFFBEB"
                : "var(--color-bg)";
  const border  = error   ? "1px solid #FCA5A5"
                : warning ? "1px solid #FDE047"
                : "1px solid var(--color-border)";

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "4px",
      padding: "8px 10px",
      background: bg, border, borderRadius: "var(--radius-sm)",
      opacity: isRemoved ? 0.5 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        {/* Index badge */}
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700,
          color: "var(--color-text-tertiary)", minWidth: "16px", flexShrink: 0,
        }}>
          {index + 1}
        </span>

        {/* Condition */}
        <select
          value={rule.condition}
          disabled={isRemoved}
          onChange={(e) => {
            const condition = e.target.value as ParseRuleCondition;
            // Clear match when switching to 'always'
            onChange({ condition, ...(condition === "always" ? { match: undefined } : {}) });
          }}
          style={{ ...selectStyle, height: "30px", fontSize: "11px" }}
        >
          {validConditions.map((c) => (
            <option key={c} value={c}>{CONDITION_LABELS[c] ?? c}</option>
          ))}
        </select>

        {/* Match input — hidden for 'always' */}
        {showMatch && (
          <input
            value={rule.match ?? ""}
            disabled={isRemoved}
            placeholder={rule.condition === "regex" ? "pattern" : "value"}
            onChange={(e) => onChange({ match: e.target.value })}
            style={{ ...inputStyle, height: "30px", fontSize: "11px", width: "120px" }}
          />
        )}

        {/* Case-sensitive toggle — hidden for 'always' and 'regex' (regex has its own flags) */}
        {showMatch && rule.condition !== "regex" && (
          <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: isRemoved ? "default" : "pointer", flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={rule.case_sensitive}
              disabled={isRemoved}
              onChange={(e) => onChange({ case_sensitive: e.target.checked })}
              style={{ accentColor: "var(--color-accent)", width: "12px", height: "12px" }}
            />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
              case-sensitive
            </span>
          </label>
        )}

        {/* Arrow separator */}
        <span style={{ color: "var(--color-text-tertiary)", fontSize: "11px", flexShrink: 0 }}>→</span>

        {/* Action */}
        <select
          value={rule.action}
          disabled={isRemoved}
          onChange={(e) => {
            const action = e.target.value as ParseRuleAction;
            onChange({ action, ...(VALUELESS_ACTIONS.has(action) ? { value: undefined } : {}) });
          }}
          style={{ ...selectStyle, height: "30px", fontSize: "11px" }}
        >
          {validActions.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
          ))}
        </select>

        {/* Value input */}
        {showValue && (
          <input
            value={rule.value ?? ""}
            disabled={isRemoved}
            placeholder="value"
            onChange={(e) => onChange({ value: e.target.value })}
            style={{ ...inputStyle, height: "30px", fontSize: "11px", width: "140px" }}
          />
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Reorder + remove controls */}
        {!isRemoved && (
          <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
            <button
              onClick={() => onMove(-1)}
              disabled={index === 0}
              title="Move up"
              style={{
                background: "none", border: "none", cursor: index === 0 ? "default" : "pointer",
                padding: "2px 4px", borderRadius: "3px",
                color: index === 0 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
                fontSize: "12px", lineHeight: 1,
              }}
            >
              ↑
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              title="Move down"
              style={{
                background: "none", border: "none", cursor: index === total - 1 ? "default" : "pointer",
                padding: "2px 4px", borderRadius: "3px",
                color: index === total - 1 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
                fontSize: "12px", lineHeight: 1,
              }}
            >
              ↓
            </button>
            <button
              onClick={onRemove}
              title="Remove rule"
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "2px 4px", borderRadius: "3px",
                color: "var(--color-text-tertiary)",
                fontSize: "14px", lineHeight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-danger)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Inline validation feedback */}
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)", margin: 0, paddingLeft: "22px" }}>
          {error}
        </p>
      )}
      {!error && warning && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "#92400E", margin: 0, paddingLeft: "22px" }}>
          {warning}
        </p>
      )}
    </div>
  );
}

// ─── Rules panel (accordion body) ─────────────────────────────────────────────

function RulesPanel({
  row,
  validConditions,
  validActions,
  onChangeRules,
  onChangeDelimiter,
  rowErrors,
  rowWarnings,
}: {
  row:               RichMappingRow;
  validConditions:   string[];
  validActions:      string[];
  onChangeRules:     (rules: ParseRule[]) => void;
  onChangeDelimiter: (delimiter: string) => void;
  rowErrors:         ValidationIssue[];
  rowWarnings:       ValidationIssue[];
}) {
  const isRemoved  = row.state === "removed";
  const isMulti    = row.type === "multi_select";

  const defaultRule = (): ParseRule => ({
    condition:      "always",
    case_sensitive: false,
    action:         "set",
    value:          "",
  });

  function handleRuleChange(idx: number, patch: Partial<ParseRule>) {
    const next = row.rules.map((r, i) => i === idx ? { ...r, ...patch } : r);
    onChangeRules(next);
  }

  function handleMove(idx: number, dir: -1 | 1) {
    const next = [...row.rules];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChangeRules(next);
  }

  function handleRemove(idx: number) {
    onChangeRules(row.rules.filter((_, i) => i !== idx));
  }

  function handleAdd() {
    onChangeRules([...row.rules, defaultRule()]);
  }

  return (
    <div style={{
      background: "var(--color-bg)",
      borderTop: "1px solid var(--color-border)",
      padding: "12px 14px 14px 28px",
    }}>
      {/* Delimiter input for multi_select */}
      {isMulti && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>
            Delimiter
          </span>
          <input
            value={row.delimiter}
            disabled={isRemoved}
            placeholder=","
            onChange={(e) => onChangeDelimiter(e.target.value)}
            style={{ ...inputStyle, height: "28px", fontSize: "11px", width: "60px", fontFamily: "var(--font-mono)" }}
          />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            default: comma
          </span>
        </div>
      )}

      {/* Rules label */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>
          Parse Rules
        </span>
        {row.rules.length === 0 && (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
            No rules — raw value passes through
          </span>
        )}
      </div>

      {/* Rule rows */}
      {row.rules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
          {row.rules.map((rule, idx) => {
            const ruleError   = rowErrors.find((e)   => e.rule_index === idx)?.message;
            const ruleWarning = rowWarnings.find((w) => w.rule_index === idx)?.message;
            return (
              <RuleRow
                key={idx}
                rule={rule}
                index={idx}
                total={row.rules.length}
                validConditions={validConditions}
                validActions={validActions}
                onChange={(patch) => handleRuleChange(idx, patch)}
                onMove={(dir) => handleMove(idx, dir)}
                onRemove={() => handleRemove(idx)}
                error={ruleError}
                warning={ruleWarning}
                isRemoved={isRemoved}
              />
            );
          })}
        </div>
      )}

      {/* Mapping-level (non-rule) errors/warnings */}
      {rowErrors.filter((e) => e.rule_index === undefined).map((e, i) => (
        <p key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)", margin: "0 0 4px" }}>
          {e.message}
        </p>
      ))}
      {rowWarnings.filter((w) => w.rule_index === undefined).map((w, i) => (
        <p key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "#92400E", margin: "0 0 4px" }}>
          {w.message}
        </p>
      ))}

      {/* Add rule button */}
      {!isRemoved && (
        <button
          onClick={handleAdd}
          style={{
            display: "flex", alignItems: "center", gap: "5px",
            background: "none", border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-sm)", padding: "5px 10px",
            cursor: "pointer", width: "100%", justifyContent: "center",
            fontFamily: "var(--font-sans)", fontSize: "11px",
            color: "var(--color-text-tertiary)",
            marginTop: row.rules.length > 0 ? "0" : "0",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-accent)";
            e.currentTarget.style.color       = "var(--color-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.color       = "var(--color-text-tertiary)";
          }}
        >
          + Add rule
        </button>
      )}
    </div>
  );
}

// ─── Single mapping row ───────────────────────────────────────────────────────

function MappingRowComponent({
  row,
  knownFields,
  validTypes,
  validConditions,
  validActions,
  onChange,
  isLast,
  viewOnly,
  baselineLabel,
  errors,
  warnings,
}: {
  row:             RichMappingRow;
  knownFields:     string[];
  validTypes:      string[];
  validConditions: string[];
  validActions:    string[];
  onChange?:       (patch: Partial<MappingRow>) => void;
  isLast:          boolean;
  viewOnly:        boolean;
  baselineLabel:   string;
  errors:          ValidationIssue[];
  warnings:        ValidationIssue[];
}) {
  const [open,         setOpen]         = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [anchorRect,   setAnchorRect]   = useState<DOMRect | null>(null);
  const rowRef      = useRef<HTMLDivElement>(null);
  const overRow     = useRef(false);
  const overTooltip = useRef(false);

  const isIgnored   = row.type === "ignore" || row.field === "__ignore__";
  const isRemoved   = row.state === "removed";
  const needsRowKey = row.type === "matrix_row";
  const needsExtra  = row.field === "extra_data";
  const colors      = ROW_COLORS[row.state];
  const badge       = BADGE_STYLES[row.state];
  const showDiff    = row.state === "changed";

  const hasRules     = row.rules.length > 0;
  const hasErrors    = errors.length > 0;
  const hasWarnings  = !hasErrors && warnings.length > 0;
  const rulesLabel   = hasRules ? `${row.rules.length} rule${row.rules.length !== 1 ? "s" : ""}` : null;

  const rowBg      = colors ? colors.bg : "var(--color-surface)";
  const borderLeft = colors ? `3px solid ${colors.border}` : "3px solid transparent";
  const opacity    = (isIgnored && !isRemoved) ? (viewOnly ? 0.45 : 0.4) : isRemoved ? 0.5 : 1;

  function handleFieldChange(field: string) {
    if (!onChange) return;
    let type = row.type;
    if (field === "__ignore__")                                             type = "ignore";
    else if (field === "availability")                                      type = "matrix_row";
    else if (field === "role_preference" || field === "event_preference")   type = "multi_select";
    else if (type === "ignore")                                             type = "string";
    onChange({ field, type, extra_key: field === "extra_data" ? row.extra_key : "" });
  }

  function handleTypeChange(type: string) {
    if (!onChange) return;
    onChange({ type, ...(type === "ignore" ? { field: "__ignore__" } : {}) });
  }

  const tryHide = useCallback(() => {
    setTimeout(() => {
      if (!overRow.current && !overTooltip.current) setTooltipVisible(false);
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

  // Toggle accordion: only fire if the click didn't land on an interactive element
  function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
    if (viewOnly || isRemoved) return;
    const tag = (e.target as HTMLElement).tagName;
    if (["SELECT", "INPUT", "BUTTON", "LABEL"].includes(tag)) return;
    // Also bail if target is inside a label (checkbox wrapper)
    if ((e.target as HTMLElement).closest("label")) return;
    setOpen((v) => !v);
  }

  // ── Key cell ────────────────────────────────────────────────────────────

  function renderKeyCell() {
    if (isRemoved) {
      return (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          excluded from save
        </span>
      );
    }
    if (needsRowKey) {
      if (viewOnly) return <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{row.row_key || "—"}</span>;
      return (
        <input
          style={{ ...inputStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          placeholder="e.g. 8:00 AM - 10:00 AM"
          value={row.row_key}
          onChange={(e) => onChange?.({ row_key: e.target.value })}
        />
      );
    }
    if (needsExtra) {
      if (viewOnly) return <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{row.extra_key || "—"}</span>;
      return (
        <input
          style={{ ...inputStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px" }}
          placeholder="extra_key name"
          value={row.extra_key}
          onChange={(e) => onChange?.({ extra_key: e.target.value })}
        />
      );
    }
    return <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>—</span>;
  }

  return (
    <>
      {/* ── Main row ── */}
      <div
        ref={rowRef}
        onClick={handleRowClick}
        onMouseEnter={handleRowMouseEnter}
        onMouseLeave={handleRowMouseLeave}
        style={{
          display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr auto",
          padding: "10px 14px", alignItems: "center", gap: "8px",
          background: rowBg,
          borderBottom: (!isLast || open) ? "1px solid var(--color-border)" : "none",
          borderLeft,
          cursor: (viewOnly || isRemoved) ? "default" : "pointer",
        }}
      >
        {/* Col 1: header name + state badge + rules badge */}
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
          {rulesLabel && !viewOnly && (
            <span style={{
              fontFamily: "var(--font-sans)", fontSize: "9px", fontWeight: 600,
              color: hasErrors ? "var(--color-danger)" : hasWarnings ? "#92400E" : "var(--color-accent)",
              background: hasErrors ? "#FEE2E2" : hasWarnings ? "#FEF9C3" : "var(--color-accent-subtle, #EEF2FF)",
              padding: "1px 5px", borderRadius: "3px", flexShrink: 0,
            }}>
              {rulesLabel}
              {hasErrors   && " ⚠"}
              {hasWarnings && " !"}
            </span>
          )}
        </div>

        {/* Col 2: field */}
        {viewOnly ? (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: isIgnored ? "var(--color-text-tertiary)" : "var(--color-text-primary)" }}>
            {isIgnored ? "—" : (KNOWN_FIELDS_LABELS[row.field] ?? row.field)}
          </span>
        ) : (
          <select value={row.field} onChange={(e) => handleFieldChange(e.target.value)} disabled={isRemoved} style={{ ...selectStyle, width: "100%", opacity }}>
            {knownFields.map((f) => (
              <option key={f} value={f}>{KNOWN_FIELDS_LABELS[f] ?? f}</option>
            ))}
          </select>
        )}

        {/* Col 3: type */}
        {viewOnly ? (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {TYPE_LABELS[row.type] ?? row.type}
          </span>
        ) : (
          <select value={row.type} onChange={(e) => handleTypeChange(e.target.value)} disabled={isRemoved || row.field === "__ignore__"} style={{ ...selectStyle, width: "100%", opacity }}>
            {validTypes.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
        )}

        {/* Col 4: key cell */}
        <div style={{ opacity }}>{renderKeyCell()}</div>

        {/* Col 5: chevron toggle */}
        {!viewOnly && !isRemoved && (
          <div style={{ color: open ? "var(--color-accent)" : "var(--color-text-tertiary)", display: "flex", alignItems: "center" }}>
            <ChevronIcon open={open} />
          </div>
        )}
      </div>

      {/* ── Rules accordion panel (edit mode) ── */}
      {open && !viewOnly && (
        <RulesPanel
          row={row}
          validConditions={validConditions}
          validActions={validActions}
          onChangeRules={(rules) => onChange?.({ rules })}
          onChangeDelimiter={(delimiter) => onChange?.({ delimiter })}
          rowErrors={errors}
          rowWarnings={warnings}
        />
      )}

      {/* ── Rules read-only display (view mode) ── */}
      {viewOnly && hasRules && (
        <div style={{
          background: "var(--color-bg)",
          borderTop: "1px solid var(--color-border)",
          borderLeft,
          padding: "8px 14px 10px 28px",
          display: "flex", flexDirection: "column", gap: "4px",
        }}>
          {row.delimiter && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>
                Delimiter
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                {row.delimiter}
              </span>
            </div>
          )}
          {row.rules.map((rule, idx) => {
            const condLabel   = CONDITION_LABELS[rule.condition] ?? rule.condition;
            const actionLabel = ACTION_LABELS[rule.action]       ?? rule.action;
            const showMatch   = rule.condition !== "always";
            const showValue   = !VALUELESS_ACTIONS.has(rule.action as ParseRuleAction);
            return (
              <div key={idx} style={{
                display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap",
                padding: "5px 8px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", minWidth: "16px" }}>
                  {idx + 1}
                </span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {condLabel}
                </span>
                {showMatch && rule.match && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-primary)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "3px", padding: "1px 5px" }}>
                    {rule.match}
                  </span>
                )}
                {showMatch && rule.case_sensitive && (
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", color: "var(--color-text-tertiary)" }}>
                    case-sensitive
                  </span>
                )}
                <span style={{ color: "var(--color-text-tertiary)", fontSize: "11px" }}>→</span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {actionLabel}
                </span>
                {showValue && rule.value && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-primary)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "3px", padding: "1px 5px" }}>
                    {rule.value}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Diff tooltip */}
      {tooltipVisible && showDiff && anchorRect && (
        <DiffTooltip
          row={row}
          anchorRect={anchorRect}
          baselineLabel={baselineLabel}
          onMouseEnter={() => { overTooltip.current = true; }}
          onMouseLeave={() => { overTooltip.current = false; tryHide(); }}
        />
      )}
    </>
  );
}

// ─── Table wrapper ────────────────────────────────────────────────────────────

export interface SheetConfigMappingTableProps {
  rows:             RichMappingRow[];
  knownFields:      string[];
  validTypes:       string[];
  validConditions?: string[];
  validActions?:    string[];
  onChangeRow?:     (idx: number, patch: Partial<MappingRow>) => void;
  viewOnly?:        boolean;
  baselineLabel?:   string;
  /** Validation errors from a 422 response, keyed per mapping header + rule_index */
  validationErrors?:   ValidationIssue[];
  validationWarnings?: ValidationIssue[];
}

export function SheetConfigMappingTable({
  rows,
  knownFields,
  validTypes,
  validConditions = [],
  validActions    = [],
  onChangeRow,
  viewOnly        = false,
  baselineLabel   = "suggestion",
  validationErrors   = [],
  validationWarnings = [],
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
        display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr auto",
        alignItems: "start",
        padding: "8px 14px",
        background: "var(--color-bg)",
        borderBottom: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md) var(--radius-md) 0 0",
        overflow: "hidden",
      }}>
        {["Sheet Column", "Field", "Type", "Extra Key / Row Key", ""].map((h, i) => (
          <span key={i} style={{
            fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.07em",
            color: "var(--color-text-tertiary)",
            whiteSpace: "normal", wordBreak: "break-word",
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ borderRadius: "0 0 var(--radius-md) var(--radius-md)", overflow: "hidden" }}>
        {rows.map((row, idx) => {
          const rowErrors   = validationErrors.filter((e)   => e.header === row.header);
          const rowWarnings = validationWarnings.filter((w) => w.header === row.header);
          return (
            <MappingRowComponent
              key={row.header}
              row={row}
              knownFields={knownFields}
              validTypes={validTypes}
              validConditions={validConditions}
              validActions={validActions}
              onChange={isViewOnly ? undefined : (patch) => onChangeRow!(idx, patch)}
              isLast={idx === rows.length - 1}
              viewOnly={isViewOnly}
              baselineLabel={baselineLabel}
              errors={rowErrors}
              warnings={rowWarnings}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Helper: build a RichMappingRow ──────────────────────────────────────────

export function makeRichRow(
  values:        MappingRow,
  baseline:      MappingRow,
  forcedState?:  "new" | "removed",
  importedValue?: MappingRow,
): RichMappingRow {
  let state: RowState = forcedState ?? "same";
  if (!forcedState) {
    state = mappingRowsEqual(values, baseline) ? "same" : "changed";
  }
  return { ...values, state, baseline, importedValue };
}