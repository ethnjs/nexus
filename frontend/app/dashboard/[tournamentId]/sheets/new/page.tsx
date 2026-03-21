"use client";

import { useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping, SheetConfig } from "@/lib/api";
import { IconArrowLeft, IconCheckCircle, IconWarning } from "@/components/ui/Icons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { RadioOption } from "@/components/ui/RadioOption";
import { StatCard } from "@/components/ui/StatCard";
import { FieldLabel } from "@/components/ui/FieldLabel";

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
  { value: "interest",     label: "Interest Form" },
  { value: "confirmation", label: "Confirmation Form" },
  { value: "events",       label: "Events" },
];

const KNOWN_FIELDS_LABELS: Record<string, string> = {
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

const TYPE_LABELS: Record<string, string> = {
  string:          "Text",
  ignore:          "Ignore",
  boolean:         "Yes/No",
  integer:         "Number",
  multi_select:    "Multi-select",
  matrix_row:      "Availability Row",
  category_events: "Category Events",
};

const WIZARD_STEPS = [
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

// ─── Save Confirmation Modal ──────────────────────────────────────────────────

function SaveConfirmModal({
  duplicates,
  onConfirm,
  onCancel,
}: {
  duplicates: SheetConfig[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: "28px",
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "12px" }}>
          Add duplicate sheet tab?
        </h2>
        <div style={{
          background: "var(--color-warning-subtle)",
          border: "1px solid var(--color-warning)",
          borderRadius: "var(--radius-md)",
          padding: "12px 14px",
          marginBottom: "20px",
        }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)", marginBottom: "6px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <IconWarning size={14} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
            This tab is already connected as:
          </p>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {duplicates.map((d) => (
              <li key={d.id} style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                <strong>{d.label}</strong> ({d.sheet_name})
              </li>
            ))}
          </ul>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
            Having multiple configs pointing at the same sheet tab is allowed, but syncing them may overwrite each other&apos;s data if they map to the same fields. Make sure this is intentional.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel}>
            Go back
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={onConfirm}>
            Add anyway
          </Button>
        </div>
      </div>
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
  const [existingConfigs, setExistingConfigs] = useState<SheetConfig[]>([]);

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
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // Results
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // ── Duplicate detection ───────────────────────────────────────────────────

  /** Configs that share the same spreadsheet_id + sheet_name as the current selection. */
  function getDuplicatesForSelection(): SheetConfig[] {
    if (!validateResult || !selectedSheet) return [];
    return existingConfigs.filter(
      (c) =>
        c.spreadsheet_id === validateResult.spreadsheet_id &&
        c.sheet_name === selectedSheet
    );
  }

  // ── Step 1: Validate URL ──────────────────────────────────────────────────

  async function handleValidateUrl() {
    if (!sheetUrl.trim()) return;
    setUrlLoading(true);
    setUrlError("");
    try {
      const [result, configs] = await Promise.all([
        sheetsApi.validate(tournamentId, sheetUrl.trim()),
        sheetsApi.listConfigs(tournamentId),
      ]);
      setValidateResult(result);
      setExistingConfigs(configs);
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
          field:     s?.field     ?? "__ignore__",
          type:      s?.type      ?? "ignore",
          row_key:   s?.row_key   ?? "",
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

  async function doSaveAndSync() {
    setShowSaveConfirm(false);
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

  function handleSaveAndSync() {
    const dupes = getDuplicatesForSelection();
    if (dupes.length > 0) {
      setShowSaveConfirm(true);
    } else {
      doSaveAndSync();
    }
  }

  function updateRow(idx: number, patch: Partial<MappingRow>) {
    setMappingRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  // Derive display step key — map "syncing" to "mapping" for indicator
  const indicatorStep = step === "syncing" ? "mapping" : step;

  // Duplicates for the current sheet-select step
  const selectStepDuplicates = step === "sheet-select" ? getDuplicatesForSelection() : [];

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

      {step !== "syncing" && (
        <StepIndicator steps={WIZARD_STEPS} current={indicatorStep} />
      )}

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

          {/* Duplicate tab warning — shown when selected sheet already exists */}
          {selectStepDuplicates.length > 0 && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "8px",
              background: "var(--color-warning-subtle)",
              border: "1px solid var(--color-warning)",
              borderRadius: "var(--radius-md)",
              padding: "12px 14px",
            }}>
              <IconWarning size={14} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "2px" }} />
              <div>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>
                  This tab is already connected
                </p>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {selectStepDuplicates.map((d) => (
                    <li key={d.id} style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      <strong>{d.label}</strong> · {d.sheet_name}
                    </li>
                  ))}
                </ul>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px" }}>
                  You can still proceed, but syncing both configs may overwrite each other&apos;s data.
                </p>
              </div>
            </div>
          )}

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
              <FieldLabel>Sheet Tab</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {validateResult.sheet_names.map((name) => (
                  <RadioOption
                    key={name}
                    name="sheet_name"
                    value={name}
                    checked={selectedSheet === name}
                    onChange={setSelectedSheet}
                    label={name}
                    mono
                  />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Sheet Type</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {SHEET_TYPES.map(({ value, label }) => (
                  <RadioOption
                    key={value}
                    name="sheet_type"
                    value={value}
                    checked={sheetType === value}
                    onChange={setSheetType}
                    label={label}
                  />
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
            <p style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            <StatCard label="Created" value={syncResult.created} color="var(--color-success)" />
            <StatCard label="Updated" value={syncResult.updated} />
            <StatCard label="Skipped" value={syncResult.skipped} color="var(--color-warning)" />
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

      {/* ── Save confirmation modal for duplicate tab ── */}
      {showSaveConfirm && (
        <SaveConfirmModal
          duplicates={getDuplicatesForSelection()}
          onConfirm={doSaveAndSync}
          onCancel={() => setShowSaveConfirm(false)}
        />
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
  const needsRowKey   = row.type === "matrix_row";
  const needsExtraKey = row.field === "extra_data";

  function handleFieldChange(field: string) {
    let type = row.type;
    if (field === "__ignore__")                                              type = "ignore";
    else if (field === "availability")                                       type = "matrix_row";
    else if (field === "role_preference" || field === "event_preference")    type = "multi_select";
    else if (type === "ignore")                                              type = "string";
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
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "12px",
        color: "var(--color-text-primary)", opacity,
        wordBreak: "break-word", paddingRight: "8px",
      }}>
        {row.header}
      </span>

      <select value={row.field} onChange={(e) => handleFieldChange(e.target.value)} style={{ ...selectStyle, width: "100%", opacity }}>
        {knownFields.map((f) => (
          <option key={f} value={f}>{KNOWN_FIELDS_LABELS[f] ?? f}</option>
        ))}
      </select>

      <select value={row.type} onChange={(e) => handleTypeChange(e.target.value)} style={{ ...selectStyle, width: "100%", opacity }} disabled={row.field === "__ignore__"}>
        {validTypes.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
        ))}
      </select>

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