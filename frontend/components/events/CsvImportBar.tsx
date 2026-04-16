"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { IconUpload, IconSheets, IconWarning } from "@/components/ui/Icons";
import {
  eventsApi,
  categoriesApi,
  EventCreate,
  TimeBlock,
  TournamentCategory,
} from "@/lib/api";

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const fields: string[] = [];
    let inQuotes = false;
    let field = "";
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (ch === '"') {
        if (inQuotes && rawLine[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    rows.push(fields);
  }
  return rows;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  rowNum:           number;
  name:             string;
  category:         string;       // raw name from CSV; empty = none
  division:         "B" | "C" | null;
  eventType:        "standard" | "trial";
  building:         string;
  room:             string;
  floor:            string;
  volunteersNeeded: number;
  blockLabels:      string[];     // known labels only (unknowns already filtered out)
}

interface ParseResult {
  valid:          ParsedRow[];
  errors:         Array<{ rowNum: number; message: string }>;
  newCategories:  string[];   // unrecognized → will auto-create
  unknownBlocks:  string[];   // unrecognized → will skip
}

interface Props {
  tournamentId:     number;
  categories:       TournamentCategory[];
  timeBlocks:       TimeBlock[];
  onImportComplete: () => Promise<void>;
}

// ─── Template + help content ──────────────────────────────────────────────────

const CSV_TEMPLATE = [
  "name,category,division,type,building,room,floor,volunteers_needed,blocks",
  '"Sample Event A",Science,B,standard,Main Building,101,1,3,"Morning A;Afternoon B"',
  '"Sample Event B",,C,trial,,,,2,',
].join("\r\n");

const HELP_COLUMNS = [
  { col: "name",               req: true,  desc: "Event name. Required." },
  { col: "category",           req: false, desc: "Category name. Unrecognized values are auto-created as custom categories." },
  { col: "division",           req: false, desc: "B, C, or leave empty." },
  { col: "type",               req: false, desc: "standard or trial. Defaults to standard." },
  { col: "building",           req: false, desc: "Building name. Free text." },
  { col: "room",               req: false, desc: "Room identifier. Free text." },
  { col: "floor",              req: false, desc: "Floor identifier. Free text." },
  { col: "volunteers_needed",  req: false, desc: "Integer ≥ 1. Defaults to 2." },
  { col: "blocks",             req: false, desc: 'Semicolon-separated block labels, e.g. "Morning A;Afternoon". Labels must match existing time blocks; unrecognized labels are skipped.' },
];

// ─── Parse CSV into structured result ─────────────────────────────────────────

function parseImportCSV(
  text: string,
  categories: TournamentCategory[],
  timeBlocks: TimeBlock[],
): ParseResult {
  const rows = parseCSVText(text);
  if (rows.length === 0) {
    return { valid: [], errors: [], newCategories: [], unknownBlocks: [] };
  }

  const headers    = rows[0].map((h) => h.toLowerCase().trim());
  const col        = (name: string) => headers.indexOf(name);
  const nameIdx    = col("name");
  const catIdx     = col("category");
  const divIdx     = col("division");
  const typeIdx    = col("type");
  const bldIdx     = col("building");
  const roomIdx    = col("room");
  const floorIdx   = col("floor");
  const volIdx     = col("volunteers_needed");
  const blocksIdx  = col("blocks");

  const knownCatNames    = new Set(categories.map((c) => c.name.toLowerCase()));
  const knownBlockLabels = new Set(timeBlocks.map((b) => b.label.toLowerCase()));

  const valid:          ParsedRow[]                            = [];
  const errors:         Array<{ rowNum: number; message: string }> = [];
  const newCategoriesSet = new Set<string>();
  const unknownBlocksSet = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i; // 1-based data row (header = row 0)
    const get    = (idx: number) => (idx >= 0 && idx < row.length ? row[idx] : "");

    const name = get(nameIdx).trim();
    if (!name) {
      errors.push({ rowNum, message: "Missing required field: name" });
      continue;
    }

    const rawType = get(typeIdx).trim().toLowerCase();
    if (rawType && rawType !== "standard" && rawType !== "trial") {
      errors.push({ rowNum, message: `Invalid type "${get(typeIdx)}". Must be "standard" or "trial".` });
      continue;
    }

    const rawVol = get(volIdx).trim();
    let volunteersNeeded = 2;
    if (rawVol !== "") {
      const n = parseInt(rawVol, 10);
      if (isNaN(n) || n < 1 || String(n) !== rawVol) {
        errors.push({ rowNum, message: `Invalid volunteers_needed "${rawVol}". Must be an integer ≥ 1.` });
        continue;
      }
      volunteersNeeded = n;
    }

    const rawDiv = get(divIdx).trim().toUpperCase();
    let division: "B" | "C" | null = null;
    if (rawDiv === "B") division = "B";
    else if (rawDiv === "C") division = "C";
    else if (rawDiv !== "") {
      errors.push({ rowNum, message: `Invalid division "${get(divIdx)}". Must be "B", "C", or empty.` });
      continue;
    }

    const categoryName = get(catIdx).trim();
    if (categoryName && !knownCatNames.has(categoryName.toLowerCase())) {
      newCategoriesSet.add(categoryName);
    }

    const rawBlocks  = get(blocksIdx).trim();
    const allLabels  = rawBlocks
      ? rawBlocks.split(";").map((l) => l.trim()).filter(Boolean)
      : [];
    for (const label of allLabels) {
      if (!knownBlockLabels.has(label.toLowerCase())) {
        unknownBlocksSet.add(label);
      }
    }
    const knownLabels = allLabels.filter((l) => knownBlockLabels.has(l.toLowerCase()));

    valid.push({
      rowNum,
      name,
      category:         categoryName,
      division,
      eventType:        rawType === "trial" ? "trial" : "standard",
      building:         get(bldIdx).trim(),
      room:             get(roomIdx).trim(),
      floor:            get(floorIdx).trim(),
      volunteersNeeded,
      blockLabels:      knownLabels,
    });
  }

  return {
    valid,
    errors,
    newCategories: [...newCategoriesSet],
    unknownBlocks: [...unknownBlocksSet],
  };
}

// ─── CsvImportBar ─────────────────────────────────────────────────────────────

export function CsvImportBar({ tournamentId, categories, timeBlocks, onImportComplete }: Props) {
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const [showHelp,     setShowHelp]     = useState(false);
  const [preview,      setPreview]      = useState<ParseResult | null>(null);
  const [importing,    setImporting]    = useState(false);
  const [importError,  setImportError]  = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  // ── File handling ────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text   = ev.target?.result as string;
      const result = parseImportCSV(text, categories, timeBlocks);
      setPreview(result);
      setImportError(null);
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so the same file can be re-selected
  };

  // ── Template download ────────────────────────────────────────────────────

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "events-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import execution ─────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!preview || preview.valid.length === 0) return;
    setImporting(true);
    setImportError(null);
    setImportProgress({ done: 0, total: preview.valid.length });

    try {
      // Build category name → id map, creating new categories first
      const catMap = new Map<string, number | null>(
        categories.map((c) => [c.name.toLowerCase(), c.id])
      );
      for (const catName of preview.newCategories) {
        const created = await categoriesApi.create(tournamentId, catName);
        catMap.set(catName.toLowerCase(), created.id);
      }

      // Block label → id map
      const blockMap = new Map<string, number>(
        timeBlocks.map((b) => [b.label.toLowerCase(), b.id])
      );

      // Create events sequentially
      for (let i = 0; i < preview.valid.length; i++) {
        const row  = preview.valid[i];
        const body: EventCreate = {
          name:              row.name,
          division:          row.division,
          event_type:        row.eventType,
          category_id:       row.category
            ? (catMap.get(row.category.toLowerCase()) ?? null)
            : null,
          building:          row.building  || null,
          room:              row.room      || null,
          floor:             row.floor     || null,
          volunteers_needed: row.volunteersNeeded,
          time_block_ids:    row.blockLabels
            .map((l) => blockMap.get(l.toLowerCase()))
            .filter((id): id is number => id !== undefined),
        };
        await eventsApi.create(tournamentId, body);
        setImportProgress({ done: i + 1, total: preview.valid.length });
      }

      setPreview(null);
      await onImportComplete();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          "8px",
          padding:      "10px 14px",
          background:   "var(--color-surface)",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          marginBottom: "20px",
          position:     "relative",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize:   "12px",
            fontWeight: 500,
            color:      "var(--color-text-secondary)",
            marginRight: "4px",
          }}
        >
          Import
        </span>

        {/* Upload CSV */}
        <label
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        "5px",
            fontFamily: "var(--font-sans)",
            fontSize:   "12px",
            fontWeight: 500,
            color:      "var(--color-text-primary)",
            background: "var(--color-accent-subtle)",
            border:     "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding:    "4px 10px",
            cursor:     "pointer",
            transition: "background var(--transition-fast)",
            userSelect: "none",
          }}
        >
          <IconUpload size={12} />
          Upload CSV
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </label>

        {/* Download template */}
        <button
          onClick={handleDownloadTemplate}
          title="Download CSV import template"
          style={{
            fontFamily:   "var(--font-sans)",
            fontSize:     "12px",
            fontWeight:   500,
            color:        "var(--color-text-secondary)",
            background:   "none",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding:      "4px 10px",
            cursor:       "pointer",
            transition:   "color var(--transition-fast)",
          }}
        >
          Template
        </button>

        {/* Help popover */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowHelp((v) => !v)}
            title="CSV import help"
            style={{
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "center",
              width:           "22px",
              height:          "22px",
              borderRadius:    "50%",
              border:          "1px solid var(--color-border)",
              background:      showHelp ? "var(--color-accent-subtle)" : "none",
              cursor:          "pointer",
              color:           "var(--color-text-tertiary)",
              fontFamily:      "var(--font-sans)",
              fontSize:        "11px",
              fontWeight:      600,
              flexShrink:      0,
            }}
          >
            ?
          </button>

          {showHelp && (
            <div
              style={{
                position:     "absolute",
                top:          "calc(100% + 8px)",
                left:         0,
                zIndex:       100,
                width:        "400px",
                background:   "var(--color-surface)",
                border:       "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                boxShadow:    "var(--shadow-lg)",
                padding:      "16px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display:        "flex",
                  justifyContent: "space-between",
                  alignItems:     "center",
                  marginBottom:   "12px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize:   "13px",
                    fontWeight: 600,
                    color:      "var(--color-text-primary)",
                  }}
                >
                  CSV Import Guide
                </span>
                <button
                  onClick={() => setShowHelp(false)}
                  style={{
                    background: "none",
                    border:     "none",
                    cursor:     "pointer",
                    color:      "var(--color-text-tertiary)",
                    fontSize:   "16px",
                    lineHeight: 1,
                    padding:    "0 2px",
                  }}
                >
                  ×
                </button>
              </div>

              <table
                style={{
                  width:           "100%",
                  borderCollapse:  "collapse",
                  fontSize:        "12px",
                  fontFamily:      "var(--font-sans)",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--color-text-secondary)", fontWeight: 600, padding: "4px 0", borderBottom: "1px solid var(--color-border)" }}>Column</th>
                    <th style={{ textAlign: "center", color: "var(--color-text-secondary)", fontWeight: 600, padding: "4px 8px", borderBottom: "1px solid var(--color-border)", width: "28px" }}>Req</th>
                    <th style={{ textAlign: "left", color: "var(--color-text-secondary)", fontWeight: 600, padding: "4px 0", borderBottom: "1px solid var(--color-border)" }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {HELP_COLUMNS.map((c) => (
                    <tr key={c.col}>
                      <td
                        style={{
                          fontFamily:   "var(--font-mono)",
                          fontSize:     "11px",
                          color:        "var(--color-text-primary)",
                          padding:      "5px 0",
                          verticalAlign: "top",
                          borderBottom: "1px solid var(--color-border)",
                          whiteSpace:   "nowrap",
                          paddingRight: "8px",
                        }}
                      >
                        {c.col}
                      </td>
                      <td
                        style={{
                          textAlign:    "center",
                          padding:      "5px 8px",
                          verticalAlign: "top",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        {c.req && (
                          <span style={{ color: "var(--color-danger)", fontWeight: 700, fontSize: "13px" }}>✱</span>
                        )}
                      </td>
                      <td
                        style={{
                          color:        "var(--color-text-secondary)",
                          padding:      "5px 0",
                          verticalAlign: "top",
                          borderBottom: "1px solid var(--color-border)",
                          lineHeight:   1.4,
                        }}
                      >
                        {c.desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize:   "11px",
                  color:      "var(--color-text-tertiary)",
                  marginTop:  "10px",
                  lineHeight: 1.4,
                }}
              >
                Headers are case-insensitive and order-independent. Download the template for an example.
              </p>
            </div>
          )}
        </div>

        <div
          style={{
            width:      "1px",
            height:     "18px",
            background: "var(--color-border)",
            margin:     "0 4px",
          }}
        />

        {/* Google Sheets — disabled until Sheets feature lands */}
        <button
          disabled
          title="Connect Google Sheets (coming soon)"
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          "5px",
            fontFamily:   "var(--font-sans)",
            fontSize:     "12px",
            fontWeight:   500,
            color:        "var(--color-text-tertiary)",
            background:   "none",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding:      "4px 10px",
            cursor:       "not-allowed",
            opacity:      0.6,
          }}
        >
          <IconSheets size={12} />
          Google Sheets
        </button>
      </div>

      {/* Help backdrop — closes popover on outside click */}
      {showHelp && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99 }}
          onClick={() => setShowHelp(false)}
        />
      )}

      {/* Import preview modal */}
      {preview && (
        <ImportPreviewModal
          result={preview}
          importing={importing}
          progress={importProgress}
          error={importError}
          onImport={handleImport}
          onCancel={() => { setPreview(null); setImportError(null); }}
        />
      )}
    </>
  );
}

// ─── Import preview modal ─────────────────────────────────────────────────────

interface PreviewModalProps {
  result:    ParseResult;
  importing: boolean;
  progress:  { done: number; total: number } | null;
  error:     string | null;
  onImport:  () => void;
  onCancel:  () => void;
}

function ImportPreviewModal({
  result,
  importing,
  progress,
  error,
  onImport,
  onCancel,
}: PreviewModalProps) {
  const { valid, errors, newCategories, unknownBlocks } = result;
  const hasWarnings = newCategories.length > 0 || unknownBlocks.length > 0;

  return (
    <Modal title="Import preview" onClose={onCancel} width={500}>
      {/* Summary line */}
      <div style={{ marginBottom: "16px" }}>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize:   "13px",
            fontWeight: 500,
            color:      "var(--color-text-primary)",
            marginBottom: errors.length > 0 ? "4px" : 0,
          }}
        >
          {valid.length === 0
            ? "No valid events found in the file."
            : `${valid.length} event${valid.length !== 1 ? "s" : ""} ready to import.`}
        </p>
        {errors.length > 0 && (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize:   "12px",
              color:      "var(--color-text-secondary)",
            }}
          >
            {errors.length} row{errors.length !== 1 ? "s" : ""} with errors will be skipped.
          </p>
        )}
      </div>

      {/* Warnings — new categories / unknown blocks */}
      {hasWarnings && (
        <div
          style={{
            padding:      "12px 14px",
            background:   "var(--color-warning-subtle)",
            border:       "1px solid var(--color-warning)",
            borderRadius: "var(--radius-md)",
            marginBottom: "14px",
            display:      "flex",
            gap:          "10px",
            alignItems:   "flex-start",
          }}
        >
          <IconWarning
            size={15}
            style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "1px" }}
          />
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize:   "12px",
              color:      "var(--color-text-primary)",
              lineHeight: 1.5,
            }}
          >
            {newCategories.length > 0 && (
              <p style={{ marginBottom: unknownBlocks.length > 0 ? "6px" : 0 }}>
                <strong>New categories will be created:</strong>{" "}
                {newCategories.join(", ")}
              </p>
            )}
            {unknownBlocks.length > 0 && (
              <p>
                <strong>Unknown block labels will be skipped:</strong>{" "}
                {unknownBlocks.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Validation error list */}
      {errors.length > 0 && (
        <div
          style={{
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            overflow:     "hidden",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              padding:        "7px 12px",
              background:     "var(--color-surface)",
              borderBottom:   "1px solid var(--color-border)",
              fontFamily:     "var(--font-sans)",
              fontSize:       "11px",
              fontWeight:     600,
              color:          "var(--color-text-secondary)",
              textTransform:  "uppercase",
              letterSpacing:  "0.04em",
            }}
          >
            Row errors
          </div>
          <div style={{ maxHeight: "160px", overflowY: "auto" }}>
            {errors.map((err) => (
              <div
                key={err.rowNum}
                style={{
                  display:      "flex",
                  gap:          "10px",
                  padding:      "7px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  fontFamily:   "var(--font-sans)",
                  fontSize:     "12px",
                }}
              >
                <span
                  style={{
                    color:      "var(--color-text-tertiary)",
                    fontWeight: 600,
                    flexShrink: 0,
                    minWidth:   "44px",
                  }}
                >
                  Row {err.rowNum}
                </span>
                <span style={{ color: "var(--color-danger)" }}>{err.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress */}
      {progress && (
        <p
          style={{
            fontFamily:   "var(--font-sans)",
            fontSize:     "12px",
            color:        "var(--color-text-secondary)",
            marginBottom: "12px",
          }}
        >
          Importing… {progress.done} / {progress.total}
        </p>
      )}

      {/* API error */}
      {error && (
        <p
          style={{
            fontFamily:   "var(--font-sans)",
            fontSize:     "12px",
            color:        "var(--color-danger)",
            marginBottom: "12px",
          }}
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={importing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onImport}
          disabled={valid.length === 0}
          loading={importing}
        >
          {importing && progress
            ? `Importing ${progress.done}/${progress.total}…`
            : `Import ${valid.length} event${valid.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </Modal>
  );
}
