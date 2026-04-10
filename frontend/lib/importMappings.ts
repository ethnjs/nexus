import type { ColumnMappingEntry, ParseRule } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MappingRow {
  column_index: number;
  header:     string;
  field:      string;
  field_type: string;
  value_type: string;   // empty string when field_type === 'ignore'
  group_key:  string;
  extra_key:  string;
  delimiter:  string;   // only used when field_type === 'list'; defaults to ''
  rules:      ParseRule[];   // ordered list; empty array = no rules
}

export interface MappingsExport {
  label?:          string;
  sheet_type?:     string;
  sheet_name?:     string;
  column_mappings: ColumnMappingEntry[];
}

export interface FieldDiff {
  label: string;
  from:  string;
  to:    string;
}

export interface RuleDiff {
  index:  number;
  status: "added" | "removed" | "changed" | "unchanged";
  from?:  ParseRule;
  to?:    ParseRule;
}

export interface ImportSummaryEntry {
  column_index: number;
  header:     string;
  from:       MappingRow;
  to:         MappingRow;
  fieldDiffs: FieldDiff[];
  ruleDiffs:  RuleDiff[];
}

export interface ImportSummary {
  /** Rows where the mapping changed */
  updated:    ImportSummaryEntry[];
  /** Count of rows that matched but had no change */
  unchanged:  number;
  /** Headers in the file that don't exist in the current sheet — ignored */
  notInSheet: string[];
  /** Headers in the sheet that weren't in the file — untouched */
  notInFile:  string[];
}

// ─── Labels (mirrored here to avoid circular imports) ─────────────────────────

const KNOWN_FIELDS_LABELS: Record<string, string> = {
  "__ignore__":          "Ignore",
  "full_name":           "Full Name",
  "first_name":          "First Name",
  "last_name":           "Last Name",
  "email":               "Email",
  "phone":               "Phone",
  "shirt_size":          "Shirt Size",
  "dietary_restriction": "Dietary Restriction",
  "university":          "University",
  "major":               "Major",
  "employer":            "Employer",
  "student_status":      "Student Status",
  "competition_exp":     "Competition Experience",
  "volunteering_exp":    "Volunteering Experience",
  "role_preference":     "Role Preference",
  "event_preference":    "Event Preference",
  "availability":        "Availability",
  "lunch_order":         "Lunch Order",
  "notes":               "Notes",
  "extra_data":          "Extra Data",
};

const FIELD_TYPE_LABELS: Record<string, string> = {
  single: "Single",
  list:   "List",
  group:  "Group",
  ignore: "Ignore",
};

const VALUE_TYPE_LABELS: Record<string, string> = {
  text:       "Text",
  number:     "Number",
  boolean:    "Yes / No",
  date:       "Date",
  time_range: "Time Range",
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
  set:     "Set to",
  replace: "Replace with",
  prepend: "Prepend",
  append:  "Append",
  discard: "Discard",
};

// ─── Rule description ─────────────────────────────────────────────────────────

/** Human-readable one-liner for a single ParseRule. */
export function describeRule(rule: ParseRule): string {
  const cond   = CONDITION_LABELS[rule.condition] ?? rule.condition;
  const action = ACTION_LABELS[rule.action]       ?? rule.action;
  const parts: string[] = [];

  if (rule.condition === "always") {
    parts.push("Always");
  } else {
    parts.push(`${cond} "${rule.match ?? ""}"`);
    if (rule.case_sensitive) parts.push("(case-sensitive)");
  }

  parts.push("→");
  parts.push(action);
  if (rule.value !== undefined) parts.push(`"${rule.value}"`);

  return parts.join(" ");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shallow equality check for two MappingRows (including rules/delimiter). */
export function mappingRowsEqual(a: MappingRow, b: MappingRow): boolean {
  if (
    a.column_index !== b.column_index ||
    a.field      !== b.field      ||
    a.field_type !== b.field_type ||
    a.value_type !== b.value_type ||
    a.group_key  !== b.group_key  ||
    a.extra_key  !== b.extra_key  ||
    a.delimiter  !== b.delimiter
  ) return false;

  if (a.rules.length !== b.rules.length) return false;
  for (let i = 0; i < a.rules.length; i++) {
    const ra = a.rules[i];
    const rb = b.rules[i];
    if (
      ra.condition                  !== rb.condition                  ||
      ra.action                     !== rb.action                     ||
      (ra.match         ?? "")      !== (rb.match         ?? "")      ||
      (ra.value         ?? "")      !== (rb.value         ?? "")      ||
      (ra.case_sensitive ?? false)  !== (rb.case_sensitive ?? false)
    ) return false;
  }
  return true;
}

function computeFieldDiffs(from: MappingRow, to: MappingRow): FieldDiff[] {
  const checks: Array<{
    label:   string;
    fromVal: string;
    toVal:   string;
    fmt?:    (v: string) => string;
  }> = [
    { label: "Field",      fromVal: from.field,      toVal: to.field,      fmt: (v) => KNOWN_FIELDS_LABELS[v] ?? v },
    { label: "Field Type", fromVal: from.field_type, toVal: to.field_type, fmt: (v) => FIELD_TYPE_LABELS[v] ?? v },
    { label: "Value Type", fromVal: from.value_type, toVal: to.value_type, fmt: (v) => VALUE_TYPE_LABELS[v] ?? v },
    { label: "Group Key",  fromVal: from.group_key,  toVal: to.group_key },
    { label: "Extra Key",  fromVal: from.extra_key,  toVal: to.extra_key },
    { label: "Delimiter",  fromVal: from.delimiter,  toVal: to.delimiter },
  ];

  const diffs: FieldDiff[] = [];
  for (const chk of checks) {
    const f = chk.fromVal ?? "";
    const t = chk.toVal   ?? "";
    if (f === t) continue;
    const fmt = chk.fmt ?? ((v: string) => v || "—");
    diffs.push({ label: chk.label, from: fmt(f), to: fmt(t) });
  }
  return diffs;
}

function rulesEqual(a: ParseRule, b: ParseRule): boolean {
  return (
    a.condition                  === b.condition                  &&
    a.action                     === b.action                     &&
    (a.match         ?? "")      === (b.match         ?? "")      &&
    (a.value         ?? "")      === (b.value         ?? "")      &&
    (a.case_sensitive ?? false)  === (b.case_sensitive ?? false)
  );
}

function computeRuleDiffs(fromRules: ParseRule[], toRules: ParseRule[]): RuleDiff[] {
  const len   = Math.max(fromRules.length, toRules.length);
  const diffs: RuleDiff[] = [];
  for (let i = 0; i < len; i++) {
    const from = fromRules[i];
    const to   = toRules[i];
    if (!from && to)  { diffs.push({ index: i, status: "added",   to });   continue; }
    if (from  && !to) { diffs.push({ index: i, status: "removed", from }); continue; }
    if (from  && to)  { diffs.push({ index: i, status: rulesEqual(from, to) ? "unchanged" : "changed", from, to }); }
  }
  return diffs;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseMappingsJson(text: string): MappingsExport | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.column_mappings) return null;
    if (!Array.isArray(parsed.column_mappings)) return null;
    return parsed as MappingsExport;
  } catch {
    return null;
  }
}

// ─── Apply import ─────────────────────────────────────────────────────────────

/**
 * Apply a parsed import file onto the current mapping rows.
 *
 * - Rows whose column_index matches the file → updated (or unchanged if identical)
 * - Rows whose header is not in the file → untouched (notInFile)
 * - Headers in the file not present in currentRows → ignored (notInSheet)
 *
 * Returns the new rows and a full ImportSummary for the modal.
 *
 * Rules/delimiter/options from the import file are carried through if present.
 */
export function applyImport(
  currentRows: MappingRow[],
  parsed:      MappingsExport,
): { updatedRows: MappingRow[]; summary: ImportSummary } {
  const importedByIndex = new Map<number, ColumnMappingEntry>(
    parsed.column_mappings.map((m) => [m.column_index, m]),
  );
  const currentIndices = new Set(currentRows.map((r) => r.column_index));

  const updated:    ImportSummaryEntry[] = [];
  let   unchanged   = 0;
  const notInSheet  = parsed.column_mappings
    .filter((m) => !currentIndices.has(m.column_index))
    .map((m) => m.header);
  const notInFile:  string[] = [];

  const updatedRows = currentRows.map((row) => {
    const m = importedByIndex.get(row.column_index);
    if (!m) {
      notInFile.push(row.header);
      return row;
    }

    const next: MappingRow = {
      column_index: row.column_index,
      header:     row.header,
      field:      m.field      ?? row.field,
      field_type: m.field_type ?? row.field_type,
      value_type: m.value_type ?? row.value_type,
      group_key:  m.group_key  ?? "",
      extra_key:  m.extra_key  ?? "",
      rules:      m.rules      ?? row.rules,
      delimiter:  m.delimiter  ?? row.delimiter,
    };

    if (!mappingRowsEqual(next, row)) {
      updated.push({
        column_index: row.column_index,
        header:     row.header,
        from:       { ...row },
        to:         next,
        fieldDiffs: computeFieldDiffs(row, next),
        ruleDiffs:  computeRuleDiffs(row.rules ?? [], next.rules ?? []),
      });
    } else {
      unchanged++;
    }

    return next;
  });

  return {
    updatedRows,
    summary: { updated, unchanged, notInSheet, notInFile },
  };
}
