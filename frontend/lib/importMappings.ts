import type { ColumnMapping, ParseRule } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MappingRow {
  header:    string;
  field:     string;
  type:      string;
  row_key:   string;
  extra_key: string;
  delimiter: string;           // only used when type === 'multi_select'; defaults to ''
  rules:     ParseRule[];      // ordered list; empty array = no rules
}

export interface MappingsExport {
  label?:          string;
  sheet_type?:     string;
  sheet_name?:     string;
  column_mappings: Record<string, ColumnMapping>;
}

export interface ImportSummaryEntry {
  header: string;
  from:   MappingRow;
  to:     MappingRow;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shallow equality check for two MappingRows (including rules/delimiter). */
export function mappingRowsEqual(a: MappingRow, b: MappingRow): boolean {
  if (
    a.field     !== b.field     ||
    a.type      !== b.type      ||
    a.row_key   !== b.row_key   ||
    a.extra_key !== b.extra_key ||
    a.delimiter !== b.delimiter
  ) return false;

  if (a.rules.length !== b.rules.length) return false;
  for (let i = 0; i < a.rules.length; i++) {
    const ra = a.rules[i];
    const rb = b.rules[i];
    if (
      ra.condition      !== rb.condition      ||
      ra.action         !== rb.action         ||
      (ra.match         ?? "") !== (rb.match  ?? "") ||
      (ra.value         ?? "") !== (rb.value  ?? "") ||
      ra.case_sensitive !== rb.case_sensitive
    ) return false;
  }
  return true;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function parseMappingsJson(text: string): MappingsExport | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.column_mappings) return null;
    return parsed as MappingsExport;
  } catch {
    return null;
  }
}

/**
 * Parse a CSV exported by our exportCsv helper.
 * Expected header row: header, field, type, row_key, extra_key
 * Note: rules/delimiter cannot round-trip through CSV — they are silently dropped
 * and the imported mapping will have empty rules/delimiter.
 */
export function parseMappingsCsv(text: string): MappingsExport | null {
  try {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;

    function parseLine(line: string): string[] {
      const cells: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === "," && !inQuote) {
          cells.push(cur); cur = "";
        } else {
          cur += ch;
        }
      }
      cells.push(cur);
      return cells;
    }

    const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
    const headerIdx   = header.indexOf("header");
    const fieldIdx    = header.indexOf("field");
    const typeIdx     = header.indexOf("type");
    const rowKeyIdx   = header.indexOf("row_key");
    const extraKeyIdx = header.indexOf("extra_key");

    if (headerIdx === -1 || fieldIdx === -1 || typeIdx === -1) return null;

    const column_mappings: Record<string, ColumnMapping> = {};
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = parseLine(lines[i]);
      const colHeader = cells[headerIdx]?.trim();
      if (!colHeader) continue;
      const mapping: ColumnMapping = {
        field: cells[fieldIdx]?.trim() ?? "__ignore__",
        type:  (cells[typeIdx]?.trim() ?? "ignore") as ColumnMapping["type"],
      };
      if (rowKeyIdx   !== -1 && cells[rowKeyIdx]?.trim())   mapping.row_key   = cells[rowKeyIdx].trim();
      if (extraKeyIdx !== -1 && cells[extraKeyIdx]?.trim()) mapping.extra_key = cells[extraKeyIdx].trim();
      // rules/delimiter are not representable in CSV — left absent (backend defaults to []/null)
      column_mappings[colHeader] = mapping;
    }

    return { column_mappings };
  } catch {
    return null;
  }
}

// ─── Apply import ─────────────────────────────────────────────────────────────

/**
 * Apply a parsed import file onto the current mapping rows.
 *
 * - Rows whose header matches the file → updated (or unchanged if identical)
 * - Rows whose header is not in the file → untouched (notInFile)
 * - Headers in the file not present in currentRows → ignored (notInSheet)
 *
 * Returns the new rows and a full ImportSummary for the modal.
 *
 * Rules/delimiter from the import file are carried through if present.
 * CSV imports (which lack rules) leave existing rules intact.
 */
export function applyImport(
  currentRows: MappingRow[],
  parsed:      MappingsExport,
): { updatedRows: MappingRow[]; summary: ImportSummary } {
  const importedMappings = parsed.column_mappings;
  const currentHeaders   = new Set(currentRows.map((r) => r.header));

  const updated:    ImportSummaryEntry[] = [];
  let   unchanged   = 0;
  const notInSheet  = Object.keys(importedMappings).filter((h) => !currentHeaders.has(h));
  const notInFile:  string[] = [];

  const updatedRows = currentRows.map((row) => {
    const m = importedMappings[row.header];
    if (!m) {
      notInFile.push(row.header);
      return row;
    }

    const next: MappingRow = {
      header:    row.header,
      field:     m.field     ?? row.field,
      type:      m.type      ?? row.type,
      row_key:   m.row_key   ?? "",
      extra_key: m.extra_key ?? "",
      // If the import file has rules/delimiter, use them; otherwise preserve current
      rules:     m.rules     ?? row.rules,
      delimiter: m.delimiter ?? row.delimiter,
    };

    const changed = !mappingRowsEqual(next, row);

    if (changed) {
      updated.push({ header: row.header, from: { ...row }, to: next });
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