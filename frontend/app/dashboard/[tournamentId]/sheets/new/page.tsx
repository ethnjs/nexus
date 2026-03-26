"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping, SheetConfig, SheetHeadersResponse } from "@/lib/api";
import {
  MappingRow,
  MappingsExport,
  ImportSummary,
  parseMappingsJson,
  applyImport,
} from "@/lib/importMappings";
import {
  RichMappingRow,
  makeRichRow,
  SheetConfigMappingTable,
} from "@/components/ui/SheetConfigMappingTable";
import { IconArrowLeft, IconCheckCircle, IconWarning } from "@/components/ui/Icons";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { ImportSummaryModal } from "@/components/ui/ImportSummaryModal";
import { Input } from "@/components/ui/Input";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { RadioOption } from "@/components/ui/RadioOption";
import { StatCard } from "@/components/ui/StatCard";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { useSheetValidation } from "@/lib/useSheetValidation";
import { SheetMappingValidationWarningsModal, SheetMappingValidationErrorsModal } from "@/components/ui/SheetMappingValidationModals";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "url" | "sheet-select" | "mapping" | "syncing" | "results";

interface ValidateResult {
  spreadsheet_id:    string;
  spreadsheet_title: string;
  sheet_names:       string[];
}

interface SyncResult {
  created:       number;
  updated:       number;
  skipped:       number;
  errors:        Array<{ row: number; email: string | null; detail: string }>;
  last_synced_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SHEET_TYPES = [
  { value: "interest",     label: "Interest Form" },
  { value: "confirmation", label: "Confirmation Form" },
  { value: "events",       label: "Events" },
];

const WIZARD_STEPS = [
  { key: "url",          label: "URL" },
  { key: "sheet-select", label: "Select Sheet" },
  { key: "mapping",      label: "Map Columns" },
  { key: "results",      label: "Done" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an empty MappingRow (baseline defaults). */
function emptyMappingRow(header: string, s?: ColumnMapping): MappingRow {
  return {
    header,
    field:     s?.field     ?? "__ignore__",
    type:      s?.type      ?? "ignore",
    row_key:   s?.row_key   ?? "",
    extra_key: s?.extra_key ?? "",
    delimiter: s?.delimiter ?? "",
    rules:     s?.rules     ?? [],
  };
}

// ─── Save Confirmation Modal (duplicate tab) ──────────────────────────────────

function SaveConfirmModal({
  duplicates,
  onConfirm,
  onCancel,
}: {
  duplicates: SheetConfig[];
  onConfirm:  () => void;
  onCancel:   () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}
    >
      <div
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "28px", width: 420, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "12px" }}>
          Add duplicate sheet tab?
        </h2>
        <div style={{ background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning)", borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: "20px" }}>
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
            Having multiple configs pointing at the same sheet tab is allowed, but syncing them may overwrite each other&apos;s data if they map to the same fields.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" size="md" fullWidth onClick={onCancel}>Go back</Button>
          <Button variant="primary"   size="md" fullWidth onClick={onConfirm}>Add anyway</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewSheetPage() {
  const router       = useRouter();
  const params       = useParams();
  const tournamentId = Number(params.tournamentId);

  const [step, setStep] = useState<Step>("url");

  // Step 1
  const [sheetUrl,        setSheetUrl]        = useState("");
  const [urlLoading,      setUrlLoading]      = useState(false);
  const [urlError,        setUrlError]        = useState("");
  const [validateResult,  setValidateResult]  = useState<ValidateResult | null>(null);
  const [existingConfigs, setExistingConfigs] = useState<SheetConfig[]>([]);

  // Step 2
  const [selectedSheet,  setSelectedSheet]  = useState("");
  const [sheetType,      setSheetType]      = useState("interest");
  const [sheetLabel,     setSheetLabel]     = useState("");
  const [headersLoading, setHeadersLoading] = useState(false);
  const [headersError,   setHeadersError]   = useState("");
  const [headersResult,  setHeadersResult]  = useState<SheetHeadersResponse | null>(null);

  // Step 3
  const [mappingRows,       setMappingRows]       = useState<RichMappingRow[]>([]);
  const [saveLoading,       setSaveLoading]       = useState(false);
  const [showSaveConfirm,   setShowSaveConfirm]   = useState(false);
  const [showWarningsConfirm,  setShowWarningsConfirm]  = useState(false);
  const [showErrorsModal,      setShowErrorsModal]      = useState(false);
  const [importBanner,      setImportBanner]      = useState<{ variant: "success" | "error"; message: string; summary?: ImportSummary } | null>(null);
  const [showImportSummary, setShowImportSummary] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Validation (shared hook)
  const {
    validationErrors, validationWarnings,
    clearAll, clearRow, handle422, handleSaveSuccess, handleValidateResult, setGenericError, renderErrorBanner,
  } = useSheetValidation();

  // Results
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // ── Duplicate detection ───────────────────────────────────────────────────

  function getDuplicatesForSelection(): SheetConfig[] {
    if (!validateResult || !selectedSheet) return [];
    return existingConfigs.filter(
      (c) => c.spreadsheet_id === validateResult.spreadsheet_id && c.sheet_name === selectedSheet
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

      const rows: RichMappingRow[] = result.headers.map((header) => {
        const base = emptyMappingRow(header, result.suggestions[header]);
        return makeRichRow(base, base);
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

  // ── Step 3: Import file ───────────────────────────────────────────────────

  function triggerImport() {
    setImportBanner(null);
    importInputRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const isJson = file.name.endsWith(".json") || file.type === "application/json";

    if (!isJson) {
      setImportBanner({ variant: "error", message: "Unsupported file type. Please upload a .json file." });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed: MappingsExport | null = parseMappingsJson(text);

      if (!parsed) {
        setImportBanner({ variant: "error", message: "Invalid JSON file — expected { column_mappings: { ... } }" });
        return;
      }

      const plainRows: MappingRow[] = mappingRows.map((r) => ({
        header: r.header, field: r.field, type: r.type,
        row_key: r.row_key, extra_key: r.extra_key,
        delimiter: r.delimiter, rules: r.rules,
      }));

      const { updatedRows, summary } = applyImport(plainRows, parsed);

      setMappingRows((prev) =>
        prev.map((r) => {
          const updated = updatedRows.find((u) => u.header === r.header);
          if (!updated) return r;
          const importedValue: MappingRow = { ...updated };
          return makeRichRow(updated, r.baseline, undefined, importedValue);
        })
      );

      if (parsed.label && !sheetLabel) setSheetLabel(parsed.label);
      if (parsed.sheet_type) setSheetType(parsed.sheet_type);

      const { updated: updatedList, unchanged, notInSheet, notInFile } = summary;
      const shortMsg = `${updatedList.length} updated, ${unchanged} unchanged, ${notInSheet.length} ignored, ${notInFile.length} untouched`;
      setImportBanner({ variant: "success", message: `Import successful: ${shortMsg}`, summary });

      // Mark rows with rule changes to open on next render, then clear the flag
      setMappingRows((prev) => prev.map((r) => ({
        ...r,
        openOnMount: updatedList.some(
          (entry) => entry.header === r.header && entry.ruleDiffs.some((d) => d.status !== "unchanged")
        ) || undefined,
      })));
      setTimeout(() => setMappingRows((prev) => prev.map((r) => ({ ...r, openOnMount: undefined }))), 50);
    };
    reader.readAsText(file);
  }

  // ── Step 3: Build payload ─────────────────────────────────────────────────

  const buildColumnMappings = useCallback((): Record<string, ColumnMapping> => {
    const result: Record<string, ColumnMapping> = {};
    for (const row of mappingRows) {
      const mapping: ColumnMapping = { field: row.field, type: row.type as ColumnMapping["type"] };
      if (row.type === "matrix_row"   && row.row_key)   mapping.row_key   = row.row_key;
      if (row.field === "extra_data"  && row.extra_key) mapping.extra_key = row.extra_key;
      if (row.type === "multi_select" && row.delimiter) mapping.delimiter = row.delimiter;
      if (row.rules.length > 0) mapping.rules = row.rules;
      result[row.header] = mapping;
    }
    return result;
  }, [mappingRows]);

  // ── Step 3: Save + Sync ───────────────────────────────────────────────────

  // Performs the actual create + sync (only called after validation passes and
  // any confirm modals are dismissed).
  async function doSaveAndSync() {
    setShowSaveConfirm(false);
    setShowWarningsConfirm(false);
    setSaveLoading(true);
    setStep("syncing");
    try {
      const config = await sheetsApi.createConfig(tournamentId, {
        tournament_id:   tournamentId,
        label:           sheetLabel || validateResult?.spreadsheet_title || "Untitled Sheet",
        sheet_type:      sheetType as "interest" | "confirmation" | "events",
        sheet_url:       sheetUrl.trim(),
        sheet_name:      selectedSheet,
        column_mappings: buildColumnMappings(),
      });
      handleSaveSuccess(config);
      const result = await sheetsApi.sync(tournamentId, config.id);
      setSyncResult(result);
      setStep("results");
    } catch (e: unknown) {
      setStep("mapping");
      if (!handle422(e)) setGenericError(e instanceof Error ? e.message : "Failed to save sheet configuration.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleSaveAndSync() {
    const dupes = getDuplicatesForSelection();
    if (dupes.length > 0) {
      setShowSaveConfirm(true);
      return;
    }
    setSaveLoading(true);
    try {
      const validation = await sheetsApi.validateMappings(tournamentId, buildColumnMappings());
      const { ok, shouldConfirm } = handleValidateResult(validation);
      if (!ok) { setShowErrorsModal(true); return; }
      if (shouldConfirm) { setShowWarningsConfirm(true); return; }
      if (validation.warnings.length > 0) return;
      await doSaveAndSync();
    } catch (e: unknown) {
      setGenericError("Failed to validate.");
    } finally {
      setSaveLoading(false);
    }
  }

  function updateRow(idx: number, patch: Partial<MappingRow>) {
    setMappingRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        return makeRichRow(next, r.baseline, undefined, r.importedValue);
      })
    );
    const header = mappingRows[idx]?.header;
    if (header) clearRow(header);
  }

  // ── Counts ────────────────────────────────────────────────────────────────

  const changedCount  = mappingRows.filter((r) => r.state === "changed").length;
  const indicatorStep = step === "syncing" ? "mapping" : step;
  const selectStepDupes = step === "sheet-select" ? getDuplicatesForSelection() : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100%" }}>
      <button
        onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}
        style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "20px", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}
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

      {step !== "syncing" && <StepIndicator steps={WIZARD_STEPS} current={indicatorStep} />}

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
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "14px 16px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <div style={{ color: "var(--color-success)", marginTop: "2px" }}><IconCheckCircle /></div>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>{validateResult.spreadsheet_title}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px", wordBreak: "break-all" }}>{sheetUrl}</div>
            </div>
          </div>

          {selectStepDupes.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
              <IconWarning size={14} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "2px" }} />
              <div>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>This tab is already connected</p>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {selectStepDupes.map((d) => (
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

          <Input label="Sheet Label" placeholder="e.g. 2026 Nationals Interest Form" value={sheetLabel} onChange={(e) => setSheetLabel(e.target.value)} helper="A friendly name to identify this sheet in NEXUS." fullWidth />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <FieldLabel>Sheet Tab</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {validateResult.sheet_names.map((name) => (
                  <RadioOption key={name} name="sheet_name" value={name} checked={selectedSheet === name} onChange={setSelectedSheet} label={name} mono />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Sheet Type</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {SHEET_TYPES.map(({ value, label }) => (
                  <RadioOption key={value} name="sheet_type" value={value} checked={sheetType === value} onChange={setSheetType} label={label} />
                ))}
              </div>
            </div>
          </div>

          {headersError && <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>{headersError}</p>}

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
          {/* Validation banner — top of mapping section */}
          {(validationErrors.length > 0 || validationWarnings.length > 0) && (
            <div>{renderErrorBanner()}</div>
          )}

          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
                Review and adjust how each column maps to NEXUS fields.
                Ignored columns are dimmed — they won&apos;t be imported.
              </p>
              {changedCount > 0 && (
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "#854D0E" }}>
                  {changedCount} edited
                </span>
              )}
            </div>
            <div style={{ flexShrink: 0 }}>
              <Button variant="secondary" size="sm" onClick={triggerImport}>
                Import JSON
              </Button>
              <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
            </div>
          </div>

          {/* Import feedback */}
          {importBanner && (
            <Banner
              variant={importBanner.variant}
              message={importBanner.message}
              onDismiss={() => setImportBanner(null)}
              action={importBanner.summary ? (
                <Button variant="ghost" size="sm" onClick={() => setShowImportSummary(true)}>Show summary</Button>
              ) : undefined}
            />
          )}

          <SheetConfigMappingTable
            rows={mappingRows}
            knownFields={headersResult.known_fields}
            validTypes={headersResult.valid_types}
            validConditions={headersResult.valid_rule_conditions}
            validActions={headersResult.valid_rule_actions}
            onChangeRow={updateRow}
            validationErrors={validationErrors}
            validationWarnings={validationWarnings}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {renderErrorBanner()}
            <div style={{ display: "flex", gap: "10px" }}>
              <Button variant="secondary" size="lg" onClick={() => setStep("sheet-select")}>Back</Button>
              <Button variant="primary" size="lg" loading={saveLoading} onClick={handleSaveAndSync}>
                Save &amp; Sync
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── SYNCING ── */}
      {step === "syncing" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "80px 0", textAlign: "center" }}>
          <div style={{ width: "40px", height: "40px", border: "3px solid var(--color-border)", borderTopColor: "var(--color-accent)", borderRadius: "50%", animation: "spin 700ms linear infinite" }} />
          <div>
            <p style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "6px" }}>Saving &amp; syncing…</p>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>Importing volunteer data from your sheet. This may take a moment.</p>
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
                  <div key={i} style={{ padding: "10px 16px", borderBottom: i < syncResult.errors.length - 1 ? "1px solid var(--color-border)" : "none", display: "flex", gap: "12px" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>Row {err.row}</span>
                    {err.email && <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)", flexShrink: 0 }}>{err.email}</span>}
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>{err.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ color: "var(--color-success)" }}><IconCheckCircle /></span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)" }}>All rows imported successfully — no errors.</span>
            </div>
          )}

          <div>
            <Button variant="primary" size="lg" onClick={() => router.push(`/dashboard/${tournamentId}/sheets`)}>Back to Sheets</Button>
          </div>
        </div>
      )}

      {showSaveConfirm && (
        <SaveConfirmModal
          duplicates={getDuplicatesForSelection()}
          onConfirm={async () => {
            setShowSaveConfirm(false);
            setSaveLoading(true);
            try {
              const validation = await sheetsApi.validateMappings(tournamentId, buildColumnMappings());
              const { ok, shouldConfirm } = handleValidateResult(validation);
              if (!ok) { setShowErrorsModal(true); return; }
              if (shouldConfirm) { setShowWarningsConfirm(true); return; }
              if (validation.warnings.length > 0) return;
              await doSaveAndSync();
            } catch { setGenericError("Failed to validate."); }
            finally { setSaveLoading(false); }
          }}
          onCancel={() => setShowSaveConfirm(false)}
        />
      )}

      {showImportSummary && importBanner?.summary && (
        <ImportSummaryModal summary={importBanner.summary} onClose={() => setShowImportSummary(false)} />
      )}

      {showWarningsConfirm && (
        <SheetMappingValidationWarningsModal
          warnings={validationWarnings}
          onConfirm={doSaveAndSync}
          onCancel={() => setShowWarningsConfirm(false)}
        />
      )}

      {showErrorsModal && (
        <SheetMappingValidationErrorsModal
          errors={validationErrors}
          warnings={validationWarnings}
          onClose={() => setShowErrorsModal(false)}
        />
      )}
    </div>
  );
}