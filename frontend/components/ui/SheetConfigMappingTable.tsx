"use client";

import { useRef, useState, useCallback, useEffect, memo } from "react";
import type { MappingRow } from "@/lib/importMappings";
import type { ParseRule, ParseRuleCondition, ParseRuleAction, ValidationIssue } from "@/lib/api";
import { mappingRowsEqual, describeRule } from "@/lib/importMappings";
import { Select } from "@/components/ui/Select";

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

const VALUELESS_ACTIONS = new Set<ParseRuleAction>(["discard", "parse_availability"]);

// ─── Row state ────────────────────────────────────────────────────────────────

export type RowState = "same" | "changed" | "new" | "removed";

export interface RichMappingRow extends MappingRow {
  state:          RowState;
  baseline:       MappingRow;
  importedValue?: MappingRow;
  /** If true, accordion starts open. Read once at mount — has no effect after. */
  openOnMount?:   boolean;
  /** Increments when new validation results arrive — opens accordion if this row has rule-level issues. */
  validationGeneration?: number;
}

const ROW_COLORS: Record<RowState, { bg: string; border: string } | null> = {
  same:    null,
  changed: { bg: "#FFF7ED", border: "#FDBA74" },
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

const inputStyle: React.CSSProperties = {
  height: "36px", padding: "0 10px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-sans)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", cursor: "text",
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
  return lines;
}

interface RuleLineDiff {
  index:  number;
  status: "added" | "removed" | "changed" | "unchanged";
  from?:  ParseRule;
  to?:    ParseRule;
}

function ruleDiffsBetween(aRules: ParseRule[], bRules: ParseRule[]): RuleLineDiff[] {
  const len   = Math.max(aRules.length, bRules.length);
  const diffs: RuleLineDiff[] = [];
  for (let i = 0; i < len; i++) {
    const from = aRules[i];
    const to   = bRules[i];
    if (!from && to)  { diffs.push({ index: i, status: "added",   to });   continue; }
    if (from  && !to) { diffs.push({ index: i, status: "removed", from }); continue; }
    if (from  && to) {
      const same =
        from.condition                 === to.condition                 &&
        (from.match         ?? "")     === (to.match         ?? "")     &&
        (from.case_sensitive ?? false) === (to.case_sensitive ?? false) &&
        from.action                    === to.action                    &&
        (from.value         ?? "")     === (to.value         ?? "");
      diffs.push({ index: i, status: same ? "unchanged" : "changed", from, to });
    }
  }
  return diffs;
}

function TooltipRuleDiff({ diff }: { diff: RuleLineDiff }) {
  const idx = diff.index + 1;
  if (diff.status === "unchanged") return null;

  if (diff.status === "removed") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 7px", background: "#FFF5F5", border: "1px solid #FCA5A5", borderRadius: "var(--radius-sm)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "#DC2626", flexShrink: 0 }}>{idx}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#DC2626", flex: 1 }}>{describeRule(diff.from!)}</span>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", color: "#DC2626", flexShrink: 0 }}>removed</span>
      </div>
    );
  }

  if (diff.status === "added") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 7px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "var(--radius-sm)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "#16A34A", flexShrink: 0 }}>{idx}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#16A34A", fontWeight: 600, flex: 1 }}>{describeRule(diff.to!)}</span>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", color: "#16A34A", flexShrink: 0 }}>added</span>
      </div>
    );
  }

  // changed — single box, number centered, red/green flush with divider
  return (
    <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 8px", background: "var(--color-bg)", borderRight: "1px solid var(--color-border)", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)" }}>{idx}</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "4px 7px", background: "#FFF5F5", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#DC2626" }}>{describeRule(diff.from!)}</span>
        </div>
        <div style={{ padding: "4px 7px", background: "#F0FDF4" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>{describeRule(diff.to!)}</span>
        </div>
      </div>
    </div>
  );
}

function DiffSection({ fieldLines, ruleDiffs, last }: { fieldLines: DiffLine[]; ruleDiffs: RuleLineDiff[]; last: boolean }) {
  const hasRuleChanges = ruleDiffs.some((d) => d.status !== "unchanged");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px", ...(last ? {} : { paddingBottom: "10px" }) }}>
      {fieldLines.map(({ label, from, to }) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", minWidth: "64px", flexShrink: 0 }}>{label}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#DC2626" }}>{from}</span>
          <span style={{ color: "var(--color-text-tertiary)", fontSize: "10px" }}>→</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>{to}</span>
        </div>
      ))}
      {hasRuleChanges && (
        <div style={{ marginTop: fieldLines.length > 0 ? "4px" : "0" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)", marginBottom: "5px" }}>Rules</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {ruleDiffs.map((diff) => <TooltipRuleDiff key={diff.index} diff={diff} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffTooltip({ row, anchorRect, baselineLabel, onMouseEnter, onMouseLeave }: {
  row: RichMappingRow; anchorRect: DOMRect; baselineLabel: string;
  onMouseEnter: () => void; onMouseLeave: () => void;
}) {
  const current = row as MappingRow;
  const imp     = row.importedValue;
  const hasPostImportEdit = imp !== undefined && !mappingRowsEqual(imp, current);

  const sec1Target     = imp ?? current;
  const sec1FieldLines = diffBetween(row.baseline, sec1Target);
  const sec1RuleDiffs  = ruleDiffsBetween(row.baseline.rules ?? [], sec1Target.rules ?? []);
  const sec1HasChange  = sec1FieldLines.length > 0 || sec1RuleDiffs.some((d) => d.status !== "unchanged");

  const sec2FieldLines = hasPostImportEdit && imp ? diffBetween(imp, current) : [];
  const sec2RuleDiffs  = hasPostImportEdit && imp ? ruleDiffsBetween(imp.rules ?? [], current.rules ?? []) : [];
  const sec2HasChange  = sec2FieldLines.length > 0 || sec2RuleDiffs.some((d) => d.status !== "unchanged");

  if (!sec1HasChange && !sec2HasChange) return null;

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ position: "fixed", top: anchorRect.bottom + 6, left: Math.max(8, anchorRect.left), zIndex: 9999, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", padding: "10px 14px", minWidth: "260px", maxWidth: "400px" }}
    >
      {sec1HasChange && (
        <>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
            Changes from {baselineLabel}
          </p>
          <DiffSection fieldLines={sec1FieldLines} ruleDiffs={sec1RuleDiffs} last={!sec2HasChange} />
        </>
      )}
      {sec2HasChange && (
        <>
          {sec1HasChange && <div style={{ borderTop: "1px solid var(--color-border)", marginBottom: "10px" }} />}
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
            Changes from import
          </p>
          <DiffSection fieldLines={sec2FieldLines} ruleDiffs={sec2RuleDiffs} last={true} />
        </>
      )}
    </div>
  );
}

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease", flexShrink: 0 }}>
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Plus icon ────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Rule editor row ──────────────────────────────────────────────────────────

const RuleRow = memo(function RuleRow({
  rule, index, total, validConditions, validActions,
  onChange, onMove, onRemove, error, warning, isRemoved,
}: {
  rule: ParseRule; index: number; total: number;
  validConditions: string[]; validActions: string[];
  onChange: (patch: Partial<ParseRule>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  error?: string; warning?: string; isRemoved: boolean;
}) {
  const showMatch = rule.condition !== "always";
  const showValue = !VALUELESS_ACTIONS.has(rule.action as ParseRuleAction);

  // Local state for text inputs — keeps keystrokes purely local,
  // flushes to parent only on blur so the whole table doesn't re-render per keystroke.
  const [localMatch, setLocalMatch] = useState(rule.match ?? "");
  const [localValue, setLocalValue] = useState(rule.value ?? "");

  // Sync local state when the rule prop changes from outside (e.g. import, reorder)
  useEffect(() => { setLocalMatch(rule.match ?? ""); }, [rule.match]);
  useEffect(() => { setLocalValue(rule.value ?? ""); }, [rule.value]);

  const bg     = error   ? "#FFF5F5" : warning ? "#FFFBEB" : "var(--color-surface)";
  const border = error   ? "1px solid #FCA5A5" : warning ? "1px solid #FDE047" : "1px solid var(--color-border)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "8px 10px", background: bg, border, borderRadius: "var(--radius-sm)", opacity: isRemoved ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", minWidth: "16px", flexShrink: 0 }}>
          {index + 1}
        </span>

        <Select
          value={rule.condition}
          onChange={(condition) => {
            onChange({ condition: condition as ParseRuleCondition, ...(condition === "always" ? { match: undefined } : {}) });
          }}
          options={validConditions.map((c) => ({ value: c, label: CONDITION_LABELS[c] ?? c }))}
          disabled={isRemoved}
          size="sm"
          minWidth={120}
          background="var(--color-bg)"
        />

        {showMatch && (
          <input
            value={localMatch} disabled={isRemoved}
            placeholder={rule.condition === "regex" ? "pattern" : "value"}
            onChange={(e) => setLocalMatch(e.target.value)}
            onBlur={() => { if (localMatch !== (rule.match ?? "")) onChange({ match: localMatch }); }}
            style={{ ...inputStyle, height: "30px", fontSize: "11px", width: "300px", fontFamily: "var(--font-mono)" }}
          />
        )}

        {showMatch && rule.condition !== "regex" && (
          <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: isRemoved ? "default" : "pointer", flexShrink: 0 }}>
            <input
              type="checkbox" checked={rule.case_sensitive} disabled={isRemoved}
              onChange={(e) => onChange({ case_sensitive: e.target.checked })}
              style={{ accentColor: "var(--color-accent)", width: "12px", height: "12px" }}
            />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)" }}>case-sensitive</span>
          </label>
        )}

        <span style={{ color: "var(--color-text-tertiary)", fontSize: "11px", flexShrink: 0 }}>→</span>

        <Select
          value={rule.action}
          onChange={(action) => {
            onChange({ action: action as ParseRuleAction, ...(VALUELESS_ACTIONS.has(action as ParseRuleAction) ? { value: undefined } : {}) });
          }}
          options={validActions.map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }))}
          disabled={isRemoved}
          size="sm"
          background="var(--color-bg)"
        />

        {showValue && (
          <input
            value={localValue} disabled={isRemoved}
            placeholder="value"
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => { if (localValue !== (rule.value ?? "")) onChange({ value: localValue }); }}
            style={{ ...inputStyle, height: "30px", fontSize: "11px", width: "300px", fontFamily: "var(--font-mono)" }}
          />
        )}

        <div style={{ flex: 1 }} />

        {!isRemoved && (
          <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
            <button onClick={() => onMove(-1)} disabled={index === 0} title="Move up"
              style={{ background: "none", border: "none", cursor: index === 0 ? "default" : "pointer", padding: "2px 4px", borderRadius: "3px", color: index === 0 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)", fontSize: "12px", lineHeight: 1 }}>↑</button>
            <button onClick={() => onMove(1)} disabled={index === total - 1} title="Move down"
              style={{ background: "none", border: "none", cursor: index === total - 1 ? "default" : "pointer", padding: "2px 4px", borderRadius: "3px", color: index === total - 1 ? "var(--color-text-tertiary)" : "var(--color-text-secondary)", fontSize: "12px", lineHeight: 1 }}>↓</button>
            <button onClick={onRemove} title="Remove rule"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", borderRadius: "3px", color: "var(--color-text-tertiary)", fontSize: "14px", lineHeight: 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-danger)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; }}>×</button>
          </div>
        )}
      </div>

      {error   && <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)", margin: 0, paddingLeft: "22px" }}>{error}</p>}
      {!error && warning && <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "#92400E", margin: 0, paddingLeft: "22px" }}>{warning}</p>}
    </div>
  );
})

// ─── Rules panel ──────────────────────────────────────────────────────────────

const RulesPanel = memo(function RulesPanel({ row, validConditions, validActions, onChangeRules, onChangeDelimiter, rowErrors, rowWarnings }: {
  row: RichMappingRow; validConditions: string[]; validActions: string[];
  onChangeRules: (rules: ParseRule[]) => void;
  onChangeDelimiter: (delimiter: string) => void;
  rowErrors: ValidationIssue[]; rowWarnings: ValidationIssue[];
}) {
  const isRemoved = row.state === "removed";
  const isMulti   = row.type  === "multi_select";
  const defaultRule = (): ParseRule => ({ condition: "always", case_sensitive: false, action: "set", value: "" });

  function handleRuleChange(idx: number, patch: Partial<ParseRule>) {
    onChangeRules(row.rules.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function handleMove(idx: number, dir: -1 | 1) {
    const next = [...row.rules];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChangeRules(next);
  }

  return (
    <div style={{ background: "var(--color-bg)", padding: "12px 14px 14px 28px" }}>
      {isMulti && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>Delimiter</span>
          <input
            value={row.delimiter} disabled={isRemoved} placeholder=","
            onChange={(e) => onChangeDelimiter(e.target.value)}
            style={{ ...inputStyle, height: "28px", fontSize: "11px", width: "60px", fontFamily: "var(--font-mono)" }}
          />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>default: comma</span>
        </div>
      )}

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

      {row.rules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
          {row.rules.map((rule, idx) => {
            const ruleError   = rowErrors.find((e)   => e.rule_index === idx)?.message;
            const ruleWarning = rowWarnings.find((w) => w.rule_index === idx)?.message;
            return (
              <RuleRow
                key={idx} rule={rule} index={idx} total={row.rules.length}
                validConditions={validConditions} validActions={validActions}
                onChange={(patch) => handleRuleChange(idx, patch)}
                onMove={(dir) => handleMove(idx, dir)}
                onRemove={() => onChangeRules(row.rules.filter((_, i) => i !== idx))}
                error={ruleError} warning={ruleWarning} isRemoved={isRemoved}
              />
            );
          })}
        </div>
      )}

      {rowErrors.filter((e) => e.rule_index == null).map((e, i) => (
        <p key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)", margin: "0 0 4px" }}>{e.message}</p>
      ))}
      {rowWarnings.filter((w) => w.rule_index == null).map((w, i) => (
        <p key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "#92400E", margin: "0 0 4px" }}>{w.message}</p>
      ))}

      {!isRemoved && (
        <button
          onClick={() => onChangeRules([...row.rules, defaultRule()])}
          style={{ display: "flex", alignItems: "center", gap: "5px", background: "none", border: "1px dashed var(--color-border)", borderRadius: "var(--radius-sm)", padding: "5px 10px", cursor: "pointer", width: "100%", justifyContent: "center", fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)";  e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
        >
          + Add rule
        </button>
      )}
    </div>
  );
})

// ─── Single mapping row ───────────────────────────────────────────────────────

const MappingRowComponent = memo(function MappingRowComponent({
  row, knownFields, validTypes, validConditions, validActions,
  onChange, isFirst, viewOnly, baselineLabel, errors, warnings, validationGeneration = 0,
}: {
  row: RichMappingRow; knownFields: string[]; validTypes: string[];
  validConditions: string[]; validActions: string[];
  onChange?: (patch: Partial<MappingRow>) => void;
  isFirst: boolean; viewOnly: boolean; baselineLabel: string;
  errors: ValidationIssue[]; warnings: ValidationIssue[];

}) {
  const hasRules  = row.rules.length > 0;
  const isRemoved = row.state === "removed";
  const isIgnored = row.type === "ignore" || row.field === "__ignore__";

  // Accordion open by default when the row already has rules, or forced open by parent
  const [open,    setOpen]    = useState(hasRules || (row.openOnMount ?? false));
  const [mounted, setMounted] = useState(hasRules || (row.openOnMount ?? false));

  // When opening: mount immediately, then set open on next tick so the
  // browser has a frame to register the 0fr starting state before animating.
  function openAccordion() {
    setMounted(true);
    requestAnimationFrame(() => setOpen(true));
  }

  // When closing: set open false (starts animation), unmount after it finishes.
  function closeAccordion() {
    setOpen(false);
    setTimeout(() => setMounted(false), 220);
  }

  // Auto-close when all rules are removed
  useEffect(() => {
    if (!hasRules) closeAccordion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRules]);

  // Open accordion when new validation results arrive with rule-level issues for this row
  const hasRuleLevelIssues = errors.some((e) => e.rule_index != null) || warnings.some((w) => w.rule_index != null);
  useEffect(() => {
    if (validationGeneration > 0 && hasRuleLevelIssues) openAccordion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationGeneration]);

  const [tooltipVisible,      setTooltipVisible]      = useState(false);
  const [errorTooltipVisible, setErrorTooltipVisible] = useState(false);
  const [anchorRect,          setAnchorRect]          = useState<DOMRect | null>(null);
  const rowRef      = useRef<HTMLDivElement>(null);
  const overRow     = useRef(false);
  const overTooltip = useRef(false);

  const needsRowKey = row.type === "matrix_row";
  const needsExtra  = row.field === "extra_data";
  const colors      = ROW_COLORS[row.state];
  const badge       = BADGE_STYLES[row.state];
  const showDiff    = row.state === "changed";

  const hasErrors       = errors.length > 0;
  const hasWarnings     = !hasErrors && warnings.length > 0;
  const hasRuleErrors   = errors.some((e) => e.rule_index != null);
  const hasRuleWarnings = !hasRuleErrors && warnings.some((w) => w.rule_index != null);
  const rulesLabel      = hasRules ? `${row.rules.length} rule${row.rules.length !== 1 ? "s" : ""}` : null;

  // Background + left border: error/warning > row state > ignored > default
  const ignoredBg = "var(--color-bg)";
  const rowBg = isIgnored && !isRemoved
    ? ignoredBg
    : hasErrors
    ? "#FFF5F5"
    : hasWarnings
    ? "#FFFBEB"
    : colors
    ? colors.bg
    : "var(--color-surface)";

  const borderLeft = hasErrors
    ? "3px solid #FCA5A5"
    : hasWarnings
    ? "3px solid #FDE047"
    : colors
    ? `3px solid ${colors.border}`
    : "3px solid transparent";

  // Icon in rightmost column:
  // - removed/ignored → nothing
  // - has rules → chevron (toggles accordion)
  // - no rules, not ignored → plus (adds first rule)
  const showChevron = !isRemoved && !isIgnored && hasRules && !viewOnly;
  const showPlus    = !isRemoved && !isIgnored && !hasRules && !viewOnly;

  function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
    if (viewOnly || isRemoved || isIgnored) return;
    // Only toggle accordion when there are rules and the click wasn't on an interactive element
    if (!hasRules) return;
    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (["SELECT", "INPUT", "BUTTON", "LABEL"].includes(tag)) return;
    if (target.closest("label")) return;
    // Guard against clicks inside the custom Select dropdown panel (fixed-positioned divs)
    if (target.closest("[data-select-panel]") || target.closest("[data-select-trigger]")) return;
    if (open) { closeAccordion(); } else { openAccordion(); }
  }

  function handlePlusClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onChange) return;
    const newRule: ParseRule = { condition: "always", case_sensitive: false, action: "set", value: "" };
    onChange({ rules: [newRule] });
    openAccordion();
  }

  const tryHide = useCallback(() => {
    setTimeout(() => {
      if (!overRow.current && !overTooltip.current) setTooltipVisible(false);
    }, 80);
  }, []);

  function handleRowMouseEnter() {
    if (!rowRef.current) return;
    overRow.current = true;
    setAnchorRect(rowRef.current.getBoundingClientRect());
    if (showDiff) setTooltipVisible(true);
    if (hasErrors || hasWarnings) setErrorTooltipVisible(true);
  }

  function handleRowMouseLeave() {
    overRow.current = false;
    tryHide();
    setErrorTooltipVisible(false);
  }

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

  const keyInputStyle: React.CSSProperties = { ...inputStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px", opacity: isIgnored ? 0.5 : 1 };

  function renderKeyCell() {
    if (isRemoved) return <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>excluded from save</span>;
    if (needsRowKey) {
      if (viewOnly) return <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{row.row_key || "—"}</span>;
      return <input style={keyInputStyle} placeholder="e.g. 8:00 AM - 10:00 AM" value={row.row_key} onChange={(e) => onChange?.({ row_key: e.target.value })} />;
    }
    if (needsExtra) {
      if (viewOnly) return <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{row.extra_key || "—"}</span>;
      return <input style={keyInputStyle} placeholder="extra_key name" value={row.extra_key} onChange={(e) => onChange?.({ extra_key: e.target.value })} />;
    }
    return <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>—</span>;
  }

  return (
    <>
      <div
        ref={rowRef}
        onClick={handleRowClick}
        onMouseEnter={handleRowMouseEnter}
        onMouseLeave={handleRowMouseLeave}
        style={{
          display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr auto",
          padding: "10px 14px", alignItems: "center", gap: "8px",
          background: rowBg,
          borderTop: isFirst ? "none" : "2px solid var(--color-border)",
          borderLeft,
          // Only show pointer cursor when there are rules to toggle
          cursor: (!viewOnly && !isRemoved && !isIgnored && hasRules) ? "pointer" : "default",
        }}
      >
        {/* Col 1: header + badges */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-primary)", opacity: isIgnored ? 0.4 : 1, wordBreak: "break-word", lineHeight: 1.4 }}>
            {row.header}
          </span>
          {badge && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: badge.color, background: badge.bg, padding: "1px 5px", borderRadius: "3px", flexShrink: 0 }}>
              {badge.label}
            </span>
          )}
          {rulesLabel && !viewOnly && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "9px", fontWeight: 600, color: hasRuleErrors ? "var(--color-danger)" : hasRuleWarnings ? "#92400E" : "var(--color-accent)", background: hasRuleErrors ? "#FEE2E2" : hasRuleWarnings ? "#FEF9C3" : "var(--color-accent-subtle, #EEF2FF)", padding: "1px 5px", borderRadius: "3px", flexShrink: 0 }}>
              {rulesLabel}{hasRuleErrors && " ⚠"}{hasRuleWarnings && " !"}
            </span>
          )}
        </div>

        {/* Col 2: field */}
        {viewOnly ? (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: isIgnored ? "var(--color-text-tertiary)" : "var(--color-text-primary)" }}>
            {isIgnored ? "—" : (KNOWN_FIELDS_LABELS[row.field] ?? row.field)}
          </span>
        ) : (
          <Select
            value={row.field}
            onChange={handleFieldChange}
            options={knownFields.map((f) => ({ value: f, label: KNOWN_FIELDS_LABELS[f] ?? f }))}
            disabled={isRemoved}
            size="sm"
            background="var(--color-bg)"
            fullWidth
          />
        )}

        {/* Col 3: type */}
        {viewOnly ? (
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>{TYPE_LABELS[row.type] ?? row.type}</span>
        ) : (
          <Select
            value={row.type}
            onChange={handleTypeChange}
            options={validTypes.map((t) => ({ value: t, label: TYPE_LABELS[t] ?? t }))}
            disabled={isRemoved || isIgnored}
            size="sm"
            background="var(--color-bg)"
            fullWidth
          />
        )}

        {/* Col 4: key cell */}
        <div style={{ opacity: isIgnored ? 0.5 : 1 }}>{renderKeyCell()}</div>

        {/* Col 5: chevron / plus / nothing */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "20px" }}>
          {showChevron && (
            <div style={{ color: open ? "var(--color-accent)" : "var(--color-text-tertiary)" }}>
              <ChevronIcon open={open} />
            </div>
          )}
          {showPlus && !viewOnly && (
            <button
              onClick={handlePlusClick}
              title="Add parse rules"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", borderRadius: "3px", color: "var(--color-text-tertiary)", lineHeight: 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
            >
              <PlusIcon />
            </button>
          )}
        </div>
      </div>

      {/* Rules accordion (edit mode) — animated via grid-template-rows */}
      {!viewOnly && !isIgnored && !isRemoved && mounted && (
        <div
          style={{
            display: "grid",
            gridTemplateRows: open ? "1fr" : "0fr",
            transition: "grid-template-rows 220ms ease",
            overflow: "hidden",
          }}
        >
          <div style={{ minHeight: 0 }}>
            <RulesPanel
              row={row} validConditions={validConditions} validActions={validActions}
              onChangeRules={(rules) => onChange?.({ rules })}
              onChangeDelimiter={(delimiter) => onChange?.({ delimiter })}
              rowErrors={errors} rowWarnings={warnings}
            />
          </div>
        </div>
      )}

      {/* Rules read-only (view mode) */}
      {viewOnly && hasRules && (
        <div style={{ background: "var(--color-bg)", borderLeft, padding: "8px 14px 10px 28px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {row.delimiter && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>Delimiter</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{row.delimiter}</span>
            </div>
          )}
          {row.rules.map((rule, idx) => {
            const condLabel   = CONDITION_LABELS[rule.condition] ?? rule.condition;
            const actionLabel = ACTION_LABELS[rule.action]       ?? rule.action;
            const showMatch   = rule.condition !== "always";
            const showValue   = !VALUELESS_ACTIONS.has(rule.action as ParseRuleAction);
            return (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", padding: "5px 8px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", minWidth: "16px" }}>{idx + 1}</span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{condLabel}</span>
                {showMatch && rule.match && <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-primary)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "3px", padding: "1px 5px" }}>{rule.match}</span>}
                {showMatch && rule.case_sensitive && <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", color: "var(--color-text-tertiary)" }}>case-sensitive</span>}
                <span style={{ color: "var(--color-text-tertiary)", fontSize: "11px" }}>→</span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)" }}>{actionLabel}</span>
                {showValue && rule.value && <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-primary)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "3px", padding: "1px 5px" }}>{rule.value}</span>}
              </div>
            );
          })}
        </div>
      )}

      {tooltipVisible && showDiff && anchorRect && (
        <DiffTooltip
          row={row} anchorRect={anchorRect} baselineLabel={baselineLabel}
          onMouseEnter={() => { overTooltip.current = true; }}
          onMouseLeave={() => { overTooltip.current = false; tryHide(); }}
        />
      )}

      {errorTooltipVisible && (hasErrors || hasWarnings) && anchorRect && (
        <div
          style={{
            position: "fixed",
            top: anchorRect.bottom + 6,
            left: showDiff && tooltipVisible
              ? Math.max(8, anchorRect.left) + 420
              : Math.max(8, anchorRect.left),
            zIndex: 9999,
            background: "var(--color-surface)",
            border: `1px solid ${hasErrors ? "#FCA5A5" : "#FDE047"}`,
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            padding: "10px 14px",
            maxWidth: "380px",
            display: "flex", flexDirection: "column", gap: "6px",
          }}
        >
          {errors.length > 0 && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-danger)", marginBottom: errors.length > 0 ? "4px" : 0 }}>
              Error{errors.length !== 1 ? "s" : ""}
            </p>
          )}
          {errors.map((issue, i) => (
            <p key={`e${i}`} style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-primary)", margin: 0 }}>
              {issue.rule_index != null && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", marginRight: "6px" }}>
                  Rule {issue.rule_index + 1}
                </span>
              )}
              {issue.message}
            </p>
          ))}
          {warnings.length > 0 && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#92400E", marginTop: errors.length > 0 ? "8px" : 0, marginBottom: "4px" }}>
              Warning{warnings.length !== 1 ? "s" : ""}
            </p>
          )}
          {warnings.map((issue, i) => (
            <p key={`w${i}`} style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-primary)", margin: 0 }}>
              {issue.rule_index != null && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", marginRight: "6px" }}>
                  Rule {issue.rule_index + 1}
                </span>
              )}
              {issue.message}
            </p>
          ))}
        </div>
      )}
    </>
  );
})

// ─── Table wrapper ────────────────────────────────────────────────────────────

export interface SheetConfigMappingTableProps {
  rows: RichMappingRow[]; knownFields: string[]; validTypes: string[];
  validConditions?: string[]; validActions?: string[];
  onChangeRow?: (idx: number, patch: Partial<MappingRow>) => void;
  viewOnly?: boolean; baselineLabel?: string;
  validationErrors?: ValidationIssue[]; validationWarnings?: ValidationIssue[];
  /** Increment each time new validation results arrive — triggers accordion open for rows with rule-level issues. */
  validationGeneration?: number;
}

export function SheetConfigMappingTable({
  rows, knownFields, validTypes,
  validConditions = [], validActions = [],
  onChangeRow, viewOnly = false, baselineLabel = "suggestion",
  validationErrors = [], validationWarnings = [],
  validationGeneration = 0,
}: SheetConfigMappingTableProps) {
  const isViewOnly = viewOnly || !onChangeRow;

  // Keep a stable ref to onChangeRow so per-row callbacks don't change identity
  // on every render, which would defeat memo on MappingRowComponent.
  const onChangeRowRef = useRef(onChangeRow);
  useEffect(() => { onChangeRowRef.current = onChangeRow; }, [onChangeRow]);

  // One stable callback per row header. We key by header string (stable across
  // renders) so memo sees the same function reference unless the row is new.
  const stableCallbacks = useRef<Map<string, (patch: Partial<MappingRow>) => void>>(new Map());
  rows.forEach((row, idx) => {
    if (!stableCallbacks.current.has(row.header)) {
      stableCallbacks.current.set(row.header, (patch) => {
        onChangeRowRef.current?.(idx, patch);
      });
    }
  });
  // Clean up headers that no longer exist
  const currentHeaders = new Set(rows.map((r) => r.header));
  stableCallbacks.current.forEach((_, key) => {
    if (!currentHeaders.has(key)) stableCallbacks.current.delete(key);
  });

  if (rows.length === 0) {
    return <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>No columns mapped yet.</p>;
  }

  return (
    <div style={{ position: "relative", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "visible" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr auto", alignItems: "start", padding: "8px 14px", background: "var(--color-bg)", borderBottom: "1px solid var(--color-border)", borderRadius: "var(--radius-md) var(--radius-md) 0 0", overflow: "hidden" }}>
        {["Sheet Column", "Field", "Type", "Extra Key / Row Key", ""].map((h, i) => (
          <span key={i} style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)", whiteSpace: "normal", wordBreak: "break-word" }}>{h}</span>
        ))}
      </div>
      <div style={{ borderRadius: "0 0 var(--radius-md) var(--radius-md)", overflow: "visible" }}>
        {rows.map((row, idx) => {
          // header is list[str] | string | null — normalise to array for consistent matching.
          const matchesHeader = (h: string[] | string | null | undefined) => {
            if (!h) return false;
            if (Array.isArray(h)) return h.includes(row.header);
            return h === row.header;
          };
          const rowErrors   = validationErrors.filter((e)   => matchesHeader(e.header));
          const rowWarnings = validationWarnings.filter((w) => matchesHeader(w.header));
          return (
            <MappingRowComponent
              key={row.header} row={row}
              knownFields={knownFields} validTypes={validTypes}
              validConditions={validConditions} validActions={validActions}
              onChange={isViewOnly ? undefined : stableCallbacks.current.get(row.header)}
              isFirst={idx === 0} viewOnly={isViewOnly}
              baselineLabel={baselineLabel} errors={rowErrors} warnings={rowWarnings}
              validationGeneration={validationGeneration}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Helper: build a RichMappingRow ──────────────────────────────────────────

export function makeRichRow(
  values: MappingRow, baseline: MappingRow,
  forcedState?: "new" | "removed", importedValue?: MappingRow,
  openOnMount?: boolean,
): RichMappingRow {
  let state: RowState = forcedState ?? "same";
  if (!forcedState) state = mappingRowsEqual(values, baseline) ? "same" : "changed";
  return { ...values, state, baseline, importedValue, openOnMount };
}