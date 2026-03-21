"use client";

import { useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping } from "@/lib/api";
import { IconArrowLeft, IconCheckCircle } from "@/components/ui/Icons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
  { value: "interest",      label: "Interest Form" },
  { value: "confirmation",  label: "Confirmation Form" },
  { value: "events",        label: "Events" },
];

const KNOWN_FIELDS_LABELS: Record<string, string> = {
  "__ignore__":         "Ignore",
  "first_name":         "First Name",
  "last_name":          "Last Name",
  "email":              "Email",
  "phone":              "Phone",
  "shirt_size":         "Shirt Size",
  "dietary_restriction":"Dietary Restriction",
  "university":         "University",
  "major":              "Major",
  "employer":           "Employer",
  "role_preference":    "Role Preference",
  "event_preference":   "Event Preference",
  "availability":       "Availability",
  "lunch_order":        "Lunch Order",
  "notes":              "Notes",
  "extra_data":         "Extra Data",
};

const TYPE_LABELS: Record<string, string> = {
  string:          "Text",
  ignore:          "Ignore",
  boolean:         "Yes/No",
  integer:         "Number",
  multi_select:    "Multi-select",
  matrix_row:      "Availability Row",
  category_events: "Category Events",
};

const STEPS: { key: Step; label: string }[] = [
  { key: "url",          label: "URL" },
  { key: "sheet-select", label: "Select Sheet" },
  { key: "mapping",      label: "Map Columns" },
  { key: "results",      label: "Done" },
];

// ─── Shared select style ──────────────────────────────────────────────────────

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
    <div style={{ display: "flex", alignItems: "center", marginBottom: "36px" }}>
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
                background: done || active ? "var(--color-accent)" : "transparent",
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

  // Step 1
  const [sheetUrl, setSheetUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);

  // Step 2
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sheetType, setSheetType] = useState("interest");
  const [sheetLabel, setSheetLabel] = useState("");
  const [headersLoading, setHeadersLoading] = useState(false);
  const [headersError, setHeadersError] = useState("");
  const [headersResult, setHeadersResult] = useState<HeadersResult | null>(null);

  // Step 3
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Results
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
      const msg = e instanceof Error ? e.message : "";
      setUrlError(
        msg.includes("403") || msg.includes("access")
          ? "The service account doesn't have access to this sheet. Make sure you've shared it with the service account."
          : msg.includes("404") || msg.includes("not found")
          ? "Spreadsheet not found. Double-check the URL."
          : "Failed to validate sheet URL. Check the URL and try again."
      );
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
      const rows: MappingRow[] = result.headers.map((header) => {
        const s = result.suggestions[header];
        return {
          header,
          field:     s?.field    ?? "__ignore__",
          type:      s?.type     ?? "ignore",
          row_key:   s?.row_key  ?? "",
          extra_key: s?.extra_key ?? "",
        };
      });
      setMappingRows(rows);
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
      const config = await sheetsApi.createConfig(tournamentId, {
        tournament_id: tournamentId,
        label: sheetLabel || validateResult?.spreadsheet_title || "Untitled Sheet",
        sheet_type: sheetType as "interest" | "confirmation" | "events",
        sheet_url: sheetUrl.trim(),
        sheet_name: selectedSheet,
        column_mappings: buildColumnMappings(),
      });
      const result = await sheetsApi.sync(tournamentId, config.id);
      setSyncResult(result);
      setStep("results");
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Failed to save sheet configuration.");
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
        <IconArrowLeft />
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
          <Input
            label="Google Sheets URL"
            type="url"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={sheetUrl}
            onChange={(e) => { setSheetUrl(e.target.value); setUrlError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleValidateUrl(); }}
            error={urlError}
            helper="Make sure the sheet is shared with the NEXUS service account before continuing."
            fullWidth
            autoFocus
          />
          <div>
            <Button variant="primary" size="lg" loading={urlLoading} disabled={!sheetUrl.trim()} onClick={handleValidateUrl}>
              Validate URL
            </Button>
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
              <IconCheckCircle />
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
          <Input
            label="Sheet Label"
            placeholder="e.g. 2026 Nationals Interest Form"
            value={sheetLabel}
            onChange={(e) => setSheetLabel(e.target.value)}
            helper="A friendly name to identify this sheet in NEXUS."
            fullWidth
          />

          {/* Sheet name + type in a 2-col grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400, color: "var(--color-text-secondary)", display: "block", marginBottom: "8px" }}>
                Sheet Tab
              </label>
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
              <label style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400, color: "var(--color-text-secondary)", display: "block", marginBottom: "8px" }}>
                Sheet Type
              </label>
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
            <Button variant="secondary" size="lg" onClick={() => setStep("url")}>Back</Button>
            <Button variant="primary" size="lg" loading={headersLoading} disabled={!selectedSheet} onClick={handleFetchHeaders}>
              Next — Map Columns
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Column Mapping ── */}
      {step === "mapping" && headersResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            Review and adjust how each column maps to NEXUS fields.
            Ignored columns are dimmed — they won&apos;t be imported.
          </p>

          <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
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

            {mappingRows.map((row, idx) => {
              const isIgnored = row.type === "ignore" || row.field === "__ignore__";
              return (
                <MappingTableRow
                  key={row.header}
                  row={row}
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
            <Button variant="secondary" size="lg" onClick={() => setStep("sheet-select")}>Back</Button>
            <Button variant="primary" size="lg" loading={saveLoading} onClick={handleSaveAndSync}>
              Save &amp; Sync
            </Button>
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
              Saving &amp; syncing…
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {[
              { label: "Created", value: syncResult.created, color: "var(--color-success)" },
              { label: "Updated", value: syncResult.updated, color: "var(--color-text-primary)" },
              { label: "Skipped", value: syncResult.skipped, color: "var(--color-warning)" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)", padding: "20px", textAlign: "center",
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

          {syncResult.errors.length > 0 ? (
            <div style={{ border: "1px solid var(--color-danger)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <div style={{ padding: "10px 16px", background: "var(--color-danger-subtle)", borderBottom: "1px solid var(--color-danger)" }}>
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
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>Row {err.row}</span>
                    {err.email && <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>{err.email}</span>}
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>{err.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)", padding: "16px",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{ color: "var(--color-success)" }}><IconCheckCircle /></span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>
                All rows imported successfully — no errors.
              </span>
            </div>
          )}

          <div>
            <Button variant="primary" size="lg" onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}>
              Back to Sheets
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mapping Table Row ────────────────────────────────────────────────────────

function MappingTableRow({
  row, isIgnored, knownFields, validTypes, onChange, isLast,
}: {
  row: MappingRow;
  isIgnored: boolean;
  knownFields: string[];
  validTypes: string[];
  onChange: (patch: Partial<MappingRow>) => void;
  isLast: boolean;
}) {
  const needsRowKey  = row.type === "matrix_row";
  const needsExtraKey = row.field === "extra_data";

  function handleFieldChange(field: string) {
    let type = row.type;
    if (field === "__ignore__")                            type = "ignore";
    else if (field === "availability")                     type = "matrix_row";
    else if (field === "role_preference" || field === "event_preference") type = "multi_select";
    else if (type === "ignore")                            type = "string";
    onChange({ field, type, extra_key: field === "extra_data" ? row.extra_key : "" });
  }

  function handleTypeChange(type: string) {
    onChange({ type, ...(type === "ignore" ? { field: "__ignore__" } : {}) });
  }

  const opacity = isIgnored ? 0.4 : 1;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 160px 140px 1fr",
      padding: "10px 16px", alignItems: "center", gap: "8px",
      background: isIgnored ? "var(--color-bg)" : "var(--color-surface)",
      borderBottom: isLast ? "none" : "1px solid var(--color-border)",
    }}>
      {/* Column header name */}
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "12px",
        color: "var(--color-text-primary)", opacity,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "8px",
      }} title={row.header}>
        {row.header}
      </span>

      {/* Field */}
      <select value={row.field} onChange={(e) => handleFieldChange(e.target.value)} style={{ ...selectStyle, width: "100%", opacity }}>
        {knownFields.map((f) => (
          <option key={f} value={f}>{KNOWN_FIELDS_LABELS[f] ?? f}</option>
        ))}
      </select>

      {/* Type */}
      <select value={row.type} onChange={(e) => handleTypeChange(e.target.value)} style={{ ...selectStyle, width: "100%", opacity }} disabled={row.field === "__ignore__"}>
        {validTypes.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
        ))}
      </select>

      {/* Extra / row key */}
      <div style={{ opacity }}>
        {needsRowKey ? (
          <input
            style={{ ...selectStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px" }}
            placeholder="e.g. 8:00 AM - 10:00 AM"
            value={row.row_key}
            onChange={(e) => onChange({ row_key: e.target.value })}
          />
        ) : needsExtraKey ? (
          <input
            style={{ ...selectStyle, width: "100%", fontFamily: "var(--font-mono)", fontSize: "11px" }}
            placeholder="extra_key name"
            value={row.extra_key}
            onChange={(e) => onChange({ extra_key: e.target.value })}
          />
        ) : (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>—</span>
        )}
      </div>
    </div>
  );
}