"use client";

import { useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "url" | "sheet-select" | "mapping" | "syncing" | "results";

interface ValidateResult {
  spreadsheet_id: string;
  spreadsheet_title: string;
  sheet_names: string[];
}

interface HeadersResult {
  sheet_name: string;
  headers: string[];
  suggestions: Record<string, ColumnMapping>;
  known_fields: string[];
  valid_types: string[];
}

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; email: string | null; detail: string }>;
  last_synced_at: string;
}

type MappingRow = {
  header: string;
  field: string;
  type: string;
  row_key: string;
  extra_key: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SHEET_TYPES = [
  { value: "interest", label: "Interest Form" },
  { value: "confirmation", label: "Confirmation Form" },
  { value: "events", label: "Events" },
];

const KNOWN_FIELDS_LABELS: Record<string, string> = {
  "__ignore__": "Ignore",
  "first_name": "First Name",
  "last_name": "Last Name",
  "email": "Email",
  "phone": "Phone",
  "shirt_size": "Shirt Size",
  "dietary_restriction": "Dietary Restriction",
  "university": "University",
  "major": "Major",
  "employer": "Employer",
  "role_preference": "Role Preference",
  "event_preference": "Event Preference",
  "availability": "Availability",
  "lunch_order": "Lunch Order",
  "notes": "Notes",
  "extra_data": "Extra Data",
};

const TYPE_LABELS: Record<string, string> = {
  string: "Text",
  ignore: "Ignore",
  boolean: "Yes/No",
  integer: "Number",
  multi_select: "Multi-select",
  matrix_row: "Availability Row",
  category_events: "Category Events",
};

const STEPS: { key: Step; label: string }[] = [
  { key: "url", label: "URL" },
  { key: "sheet-select", label: "Select Sheet" },
  { key: "mapping", label: "Map Columns" },
  { key: "results", label: "Done" },
];

// ─── Shared Styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", height: "44px", padding: "0 14px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-mono)", fontSize: "13px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", boxSizing: "border-box",
  transition: "border-color 150ms ease",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
  textTransform: "uppercase" as const, letterSpacing: "0.07em",
  color: "var(--color-text-tertiary)", display: "block", marginBottom: "6px",
};

const selectStyle: React.CSSProperties = {
  height: "36px", padding: "0 10px",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-sans)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg)",
  outline: "none", cursor: "pointer",
};

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const displaySteps = STEPS.filter((s) => s.key !== "syncing");
  const currentIdx = displaySteps.findIndex((s) => s.key === current);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "36px" }}>
      {displaySteps.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: idx < displaySteps.length - 1 ? 1 : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "24px", height: "24px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 700,
                flexShrink: 0,
                background: done ? "var(--color-accent)" : active ? "var(--color-accent)" : "transparent",
                color: done || active ? "var(--color-text-inverse)" : "var(--color-text-tertiary)",
                border: done || active ? "none" : "1px solid var(--color-border)",
              }}>
                {done ? "✓" : idx + 1}
              </div>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: active ? 600 : 400,
                color: active ? "var(--color-text-primary)" : done ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                whiteSpace: "nowrap",
              }}>
                {step.label}
              </span>
            </div>
            {idx < displaySteps.length - 1 && (
              <div style={{
                flex: 1, height: "1px", margin: "0 12px",
                background: done ? "var(--color-accent)" : "var(--color-border)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewSheetPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = Number(params.tournamentId);

  const [step, setStep] = useState<Step>("url");

  // Step 1 state
  const [sheetUrl, setSheetUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);

  // Step 2 state
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sheetType, setSheetType] = useState("interest");
  const [sheetLabel, setSheetLabel] = useState("");
  const [headersLoading, setHeadersLoading] = useState(false);
  const [headersError, setHeadersError] = useState("");
  const [headersResult, setHeadersResult] = useState<HeadersResult | null>(null);

  // Step 3 state — rows derived from headersResult
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Results state
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // ── Step 1: Validate URL ──────────────────────────────────────────────────

  async function handleValidateUrl() {
    if (!sheetUrl.trim()) return;
    setUrlLoading(true);
    setUrlError("");
    try {
      const result = await sheetsApi.validate(tournamentId, sheetUrl.trim());
      setValidateResult(result);
      setSelectedSheet(result.sheet_names[0] ?? "");
      setStep("sheet-select");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to validate sheet URL.";
      setUrlError(msg.includes("403") || msg.includes("access")
        ? "The service account doesn't have access to this sheet. Make sure you've shared it with the service account."
        : msg.includes("404") || msg.includes("not found")
        ? "Spreadsheet not found. Double-check the URL."
        : "Failed to validate sheet URL. Check the URL and try again.");
    } finally {
      setUrlLoading(false);
    }
  }

  // ── Step 2: Fetch Headers ─────────────────────────────────────────────────

  async function handleFetchHeaders() {
    if (!selectedSheet) return;
    setHeadersLoading(true);
    setHeadersError("");
    try {
      const result = await sheetsApi.headers(tournamentId, sheetUrl.trim(), selectedSheet);
      setHeadersResult(result);
      // Build initial mapping rows from suggestions
      const rows: MappingRow[] = result.headers.map((header) => {
        const suggestion = result.suggestions[header];
        return {
          header,
          field: suggestion?.field ?? "__ignore__",
          type: suggestion?.type ?? "ignore",
          row_key: suggestion?.row_key ?? "",
          extra_key: suggestion?.extra_key ?? "",
        };
      });
      setMappingRows(rows);
      // Auto-label from spreadsheet title if empty
      if (!sheetLabel) setSheetLabel(validateResult?.spreadsheet_title ?? "");
      setStep("mapping");
    } catch {
      setHeadersError("Failed to fetch sheet headers. Make sure the sheet tab exists and is accessible.");
    } finally {
      setHeadersLoading(false);
    }
  }

  // ── Step 3: Save + Sync ───────────────────────────────────────────────────

  const buildColumnMappings = useCallback((): Record<string, ColumnMapping> => {
    const result: Record<string, ColumnMapping> = {};
    for (const row of mappingRows) {
      const mapping: ColumnMapping = { field: row.field, type: row.type as ColumnMapping["type"] };
      if (row.type === "matrix_row" && row.row_key) mapping.row_key = row.row_key;
      if (row.field === "extra_data" && row.extra_key) mapping.extra_key = row.extra_key;
      result[row.header] = mapping;
    }
    return result;
  }, [mappingRows]);

  async function handleSaveAndSync() {
    setSaveLoading(true);
    setSaveError("");
    setStep("syncing");
    try {
      const columnMappings = buildColumnMappings();
      // Save config
      const config = await sheetsApi.createConfig(tournamentId, {
        tournament_id: tournamentId,
        label: sheetLabel || validateResult?.spreadsheet_title || "Untitled Sheet",
        sheet_type: sheetType as "interest" | "confirmation" | "events",
        sheet_url: sheetUrl.trim(),
        sheet_name: selectedSheet,
        column_mappings: columnMappings,
      });
      // Auto-sync
      const result = await sheetsApi.sync(tournamentId, config.id);
      setSyncResult(result);
      setStep("results");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save sheet configuration.";
      setSaveError(msg);
      setStep("mapping");
    } finally {
      setSaveLoading(false);
    }
  }

  function updateRow(idx: number, patch: Partial<MappingRow>) {
    setMappingRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100%" }}>
      {/* Back link */}
      <button
        onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}
        style={{
          display: "flex", alignItems: "center", gap: "6px", marginBottom: "20px",
          background: "none", border: "none", cursor: "pointer", padding: 0,
          fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Sheets
      </button>

      <h1 style={{ fontSize: "28px", lineHeight: 1.2, marginBottom: "4px" }}>Add Sheet</h1>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "32px" }}>
        Connect a Google Sheet to import volunteer data.
      </p>

      {step !== "syncing" && step !== "results" && <StepIndicator current={step} />}

      {/* ── STEP 1: URL ── */}
      {step === "url" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={labelStyle}>Google Sheets URL</label>
            <input
              style={inputStyle}
              type="url"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => { setSheetUrl(e.target.value); setUrlError(""); }}
              onFocus={(e) => { e.target.style.borderColor = "var(--color-border-strong)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--color-border)"; }}
              onKeyDown={(e) => { if (e.key === "Enter") handleValidateUrl(); }}
              autoFocus
            />
            {urlError && (
              <p style={{ marginTop: "8px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
                {urlError}
              </p>
            )}
            <p style={{ marginTop: "8px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              Make sure the sheet is shared with the NEXUS service account before continuing.
            </p>
          </div>
          <div>
            <PrimaryButton onClick={handleValidateUrl} loading={urlLoading} disabled={!sheetUrl.trim()}>
              Validate URL
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ── STEP 2: Sheet Select ── */}
      {step === "sheet-select" && validateResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Spreadsheet info card */}
          <div style={{
            background: "var(--color-surface)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)", padding: "14px 16px",
            display: "flex", gap: "12px", alignItems: "flex-start",
          }}>
            <div style={{ color: "var(--color-success)", marginTop: "2px" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {validateResult.spreadsheet_title}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px", wordBreak: "break-all" }}>
                {sheetUrl}
              </div>
            </div>
          </div>

          {/* Label */}
          <div>
            <label style={labelStyle}>Sheet Label</label>
            <input
              style={inputStyle}
              placeholder="e.g. 2026 Nationals Interest Form"
              value={sheetLabel}
              onChange={(e) => setSheetLabel(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = "var(--color-border-strong)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--color-border)"; }}
            />
            <p style={{ marginTop: "6px", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
              A friendly name to identify this sheet in NEXUS.
            </p>
          </div>

          {/* Sheet name + type in a 2-col grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={labelStyle}>Sheet Tab</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {validateResult.sheet_names.map((name) => (
                  <label key={name} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 12px",
                    border: `1px solid ${selectedSheet === name ? "var(--color-accent)" : "var(--color-border)"}`,
                    borderRadius: "var(--radius-sm)",
                    background: selectedSheet === name ? "var(--color-accent-subtle)" : "var(--color-bg)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-primary)",
                    transition: "border-color 120ms ease, background 120ms ease",
                  }}>
                    <input
                      type="radio" name="sheet_name" value={name}
                      checked={selectedSheet === name}
                      onChange={() => setSelectedSheet(name)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Sheet Type</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {SHEET_TYPES.map(({ value, label }) => (
                  <label key={value} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 12px",
                    border: `1px solid ${sheetType === value ? "var(--color-accent)" : "var(--color-border)"}`,
                    borderRadius: "var(--radius-sm)",
                    background: sheetType === value ? "var(--color-accent-subtle)" : "var(--color-bg)",
                    cursor: "pointer",
                    fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)",
                    transition: "border-color 120ms ease, background 120ms ease",
                  }}>
                    <input
                      type="radio" name="sheet_type" value={value}
                      checked={sheetType === value}
                      onChange={() => setSheetType(value)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {headersError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
              {headersError}
            </p>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <SecondaryButton onClick={() => setStep("url")}>Back</SecondaryButton>
            <PrimaryButton onClick={handleFetchHeaders} loading={headersLoading} disabled={!selectedSheet}>
              Next — Map Columns
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ── STEP 3: Column Mapping ── */}
      {step === "mapping" && headersResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
              Review and adjust how each column maps to NEXUS fields.
              Ignored columns are dimmed — they won&apos;t be imported.
            </p>
          </div>

          {/* Table */}
          <div style={{
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}>
            {/* Header row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr",
              padding: "8px 16px",
              background: "var(--color-bg)",
              borderBottom: "1px solid var(--color-border)",
            }}>
              {["Sheet Column", "Field", "Type", "Extra Key / Row Key"].map((h) => (
                <span key={h} style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            {mappingRows.map((row, idx) => {
              const isIgnored = row.type === "ignore" || row.field === "__ignore__";
              return (
                <MappingTableRow
                  key={row.header}
                  row={row}
                  idx={idx}
                  isIgnored={isIgnored}
                  knownFields={headersResult.known_fields}
                  validTypes={headersResult.valid_types}
                  onChange={(patch) => updateRow(idx, patch)}
                  isLast={idx === mappingRows.length - 1}
                />
              );
            })}
          </div>

          {saveError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
              {saveError}
            </p>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <SecondaryButton onClick={() => setStep("sheet-select")}>Back</SecondaryButton>
            <PrimaryButton onClick={handleSaveAndSync} loading={saveLoading}>
              Save & Sync
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ── SYNCING ── */}
      {step === "syncing" && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: "20px", padding: "80px 0", textAlign: "center",
        }}>
          <div style={{
            width: "40px", height: "40px",
            border: "3px solid var(--color-border)",
            borderTopColor: "var(--color-accent)",
            borderRadius: "50%",
            animation: "spin 700ms linear infinite",
          }} />
          <div>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
              Saving & syncing…
            </p>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              Importing volunteer data from your sheet. This may take a moment.
            </p>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── RESULTS ── */}
      {step === "results" && syncResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <StepIndicator current="results" />

          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {[
              { label: "Created", value: syncResult.created, color: "var(--color-success)" },
              { label: "Updated", value: syncResult.updated, color: "var(--color-text-primary)" },
              { label: "Skipped", value: syncResult.skipped, color: "var(--color-warning)" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)", padding: "20px",
                textAlign: "center",
              }}>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: "36px", color, lineHeight: 1, marginBottom: "6px" }}>
                  {value}
                </div>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Errors */}
          {syncResult.errors.length > 0 && (
            <div style={{
              border: "1px solid var(--color-danger)", borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 16px", background: "var(--color-danger-subtle)",
                borderBottom: syncResult.errors.length > 0 ? "1px solid var(--color-danger)" : "none",
              }}>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600, color: "var(--color-danger)" }}>
                  {syncResult.errors.length} row{syncResult.errors.length !== 1 ? "s" : ""} had errors
                </span>
              </div>
              <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                {syncResult.errors.map((err, i) => (
                  <div key={i} style={{
                    padding: "10px 16px",
                    borderBottom: i < syncResult.errors.length - 1 ? "1px solid var(--color-border)" : "none",
                    display: "flex", gap: "12px",
                  }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                      Row {err.row}
                    </span>
                    {err.email && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                        {err.email}
                      </span>
                    )}
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>
                      {err.detail}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {syncResult.errors.length === 0 && (
            <div style={{
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)", padding: "16px",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{ color: "var(--color-success)" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
                All rows imported successfully — no errors.
              </span>
            </div>
          )}

          <div>
            <PrimaryButton onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}>
              Back to Sheets
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mapping Table Row ────────────────────────────────────────────────────────

function MappingTableRow({
  row, idx, isIgnored, knownFields, validTypes, onChange, isLast,
}: {
  row: MappingRow;
  idx: number;
  isIgnored: boolean;
  knownFields: string[];
  validTypes: string[];
  onChange: (patch: Partial<MappingRow>) => void;
  isLast: boolean;
}) {
  const needsRowKey = row.type === "matrix_row";
  const needsExtraKey = row.field === "extra_data";

  // When field changes, auto-set type for known pairings
  function handleFieldChange(field: string) {
    let type = row.type;
    if (field === "__ignore__") type = "ignore";
    else if (field === "availability") type = "matrix_row";
    else if (field === "role_preference" || field === "event_preference") type = "multi_select";
    else if (field === "extra_data") {
      // keep current type or default to string
      if (type === "ignore") type = "string";
    } else {
      if (type === "ignore") type = "string";
    }
    onChange({ field, type, extra_key: field === "extra_data" ? row.extra_key : "" });
  }

  function handleTypeChange(type: string) {
    const patch: Partial<MappingRow> = { type };
    if (type === "ignore") patch.field = "__ignore__";
    onChange(patch);
  }

  const rowBg = isIgnored ? "var(--color-bg)" : "var(--color-surface)";
  const textOpacity = isIgnored ? 0.4 : 1;

  // What to show in the "Extra Key / Row Key" column
  const keyColContent = needsRowKey ? (
    <input
      style={{ ...selectStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px", opacity: textOpacity }}
      placeholder="e.g. 8:00 AM - 10:00 AM"
      value={row.row_key}
      onChange={(e) => onChange({ row_key: e.target.value })}
    />
  ) : needsExtraKey ? (
    <input
      style={{ ...selectStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px", opacity: textOpacity }}
      placeholder="extra_key name"
      value={row.extra_key}
      onChange={(e) => onChange({ extra_key: e.target.value })}
    />
  ) : null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr",
      padding: "10px 16px", alignItems: "center", gap: "8px",
      background: rowBg,
      borderBottom: isLast ? "none" : "1px solid var(--color-border)",
      transition: "background 120ms ease",
    }}>
      {/* Column header name */}
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "12px",
        color: "var(--color-text-primary)", opacity: textOpacity,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        paddingRight: "8px",
      }} title={row.header}>
        {row.header}
      </span>

      {/* Field select */}
      <select
        value={row.field}
        onChange={(e) => handleFieldChange(e.target.value)}
        style={{ ...selectStyle, width: "100%", opacity: textOpacity }}
      >
        {knownFields.map((f) => (
          <option key={f} value={f}>{KNOWN_FIELDS_LABELS[f] ?? f}</option>
        ))}
      </select>

      {/* Type select */}
      <select
        value={row.type}
        onChange={(e) => handleTypeChange(e.target.value)}
        style={{ ...selectStyle, width: "100%", opacity: textOpacity }}
        disabled={row.field === "__ignore__"}
      >
        {validTypes.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
        ))}
      </select>

      {/* Extra/row key */}
      <div style={{ opacity: textOpacity }}>
        {keyColContent ?? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            —
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Button Helpers ───────────────────────────────────────────────────────────

function PrimaryButton({
  onClick, loading, disabled, children,
}: { onClick: () => void; loading?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        height: "44px", padding: "0 20px",
        border: "none", borderRadius: "var(--radius-md)",
        background: disabled || loading ? "var(--color-text-tertiary)" : "var(--color-accent)",
        color: "var(--color-text-inverse)",
        fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", gap: "8px",
        transition: "background 150ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) e.currentTarget.style.background = "var(--color-accent-hover)";
      }}
      onMouseLeave={(e) => {
        if (!disabled && !loading) e.currentTarget.style.background = "var(--color-accent)";
      }}
    >
      {loading && (
        <span style={{
          width: "14px", height: "14px",
          border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff",
          borderRadius: "50%", display: "inline-block",
          animation: "spin 600ms linear infinite",
        }} />
      )}
      {children}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: "44px", padding: "0 20px",
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
        background: "transparent",
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
        cursor: "pointer",
        transition: "border-color 150ms ease, color 150ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border-strong)";
        e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border)";
        e.currentTarget.style.color = "var(--color-text-secondary)";
      }}
    >
      {children}
    </button>
  );
}