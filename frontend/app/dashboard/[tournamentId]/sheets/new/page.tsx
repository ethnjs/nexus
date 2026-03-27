"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { sheetsApi, ColumnMapping, SheetConfig, SheetHeadersResponse, SheetType } from "@/lib/api";
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

type Step = "url" | "sheet-select" | "form-url" | "mapping" | "syncing" | "results";

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

const SHEET_TYPES: { value: SheetType; label: string; description: string }[] = [
  { value: "volunteers", label: "Volunteers", description: "Interest forms, confirmation forms — maps to volunteer records" },
  { value: "events",     label: "Events",     description: "Event list — maps to tournament event data" },
];

// Wizard steps vary by sheet type — volunteers has a form URL step, events skips it.
function getWizardSteps(sheetType: SheetType) {
  if (sheetType === "volunteers") {
    return [
      { key: "url",          label: "URL" },
      { key: "sheet-select", label: "Select Sheet" },
      { key: "form-url",     label: "Form URL" },
      { key: "mapping",      label: "Map Columns" },
      { key: "results",      label: "Done" },
    ];
  }
  return [
    { key: "url",          label: "URL" },
    { key: "sheet-select", label: "Select Sheet" },
    { key: "mapping",      label: "Map Columns" },
    { key: "results",      label: "Done" },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  // Step 1 — Sheet URL
  const [sheetUrl,        setSheetUrl]        = useState("");
  const [urlLoading,      setUrlLoading]      = useState(false);
  const [urlError,        setUrlError]        = useState("");
  const [validateResult,  setValidateResult]  = useState<ValidateResult | null>(null);
  const [existingConfigs, setExistingConfigs] = useState<SheetConfig[]>([]);

  // Step 2 — Tab + Type
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sheetType,     setSheetType]     = useState<SheetType>("volunteers");
  const [sheetLabel,    setSheetLabel]    = useState("");

  // Step 3 — Form URL (volunteers only)
  const [formUrl,        setFormUrl]        = useState("");
  const [formUrlError,   setFormUrlError]   = useState("");
  const [formUrlLoading, setFormUrlLoading] = useState(false);

  // Step 4 — Mapping
  const [headersResult,  setHeadersResult]  = useState<SheetHeadersResponse | null>(null);
  const [mappingRows,    setMappingRows]    = useState<RichMappingRow[]>([]);
  const [saveLoading,    setSaveLoading]    = useState(false);
  const [showSaveConfirm,      setShowSaveConfirm]      = useState(false);
  const [showWarningsConfirm,  setShowWarningsConfirm]  = useState(false);
  const [showErrorsModal,      setShowErrorsModal]      = useState(false);
  const [importBanner,         setImportBanner]         = useState<{ variant: "success" | "error"; message: string; summary?: ImportSummary } | null>(null);
  const [showImportSummary,    setShowImportSummary]    = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Validation
  const {
    validationErrors, validationWarnings, validationGeneration,
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

  // ── Step 2 → 3: Advance from sheet select ────────────────────────────────

  function handleSheetSelectNext() {
    if (sheetType === "volunteers") {
      setStep("form-url");
    } else {
      // Events — skip form URL step, go straight to fetch headers
      handleFetchHeaders();
    }
  }

  // ── Step 3: Fetch Headers (called after form URL step or directly for events) ──

  async function handleFetchHeaders(providedFormUrl?: string) {
    if (!selectedSheet) return;
    setFormUrlLoading(true);
    setFormUrlError("");
    try {
      const url = providedFormUrl ?? (sheetType === "volunteers" ? formUrl.trim() : undefined);
      const result = await sheetsApi.headers(
        tournamentId,
        sheetUrl.trim(),
        selectedSheet,
        sheetType,
        url || undefined,
      );
      setHeadersResult(result);

      // Build a title → FormQuestion index for cross-referencing headers
      const questionByTitle = new Map(
        (result.form_questions ?? []).map((q) => [q.title.toLowerCase(), q])
      );
      // Also index grid row variants: "{title} [{row}]"
      for (const q of result.form_questions ?? []) {
        for (const row of q.grid_rows ?? []) {
          questionByTitle.set(`${q.title.toLowerCase()} [${row.toLowerCase()}]`, q);
        }
      }

      const rows: RichMappingRow[] = result.headers.map((header) => {
        const base = emptyMappingRow(header, result.suggestions[header]);
        // Match header to a form question (same logic as backend _match_header_to_question)
        const lower = header.toLowerCase();
        let formQuestion = questionByTitle.get(lower);
        if (!formQuestion) {
          for (const [title, q] of questionByTitle) {
            if (lower.startsWith(title)) { formQuestion = q; break; }
          }
        }
        return makeRichRow(base, base, undefined, undefined, undefined, formQuestion);
      });

      setMappingRows(rows);
      if (!sheetLabel) setSheetLabel(validateResult?.spreadsheet_title ?? "");
      setStep("mapping");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      const isFormError = msg.includes("form") || msg.includes("403") || msg.includes("access");
      setFormUrlError(
        isFormError
          ? "Could not access this form. Make sure it's shared with the NEXUS service account."
          : "Failed to fetch sheet headers. Make sure the sheet tab exists and is accessible."
      );
    } finally {
      setFormUrlLoading(false);
    }
  }

  // ── Step 3 (form-url): Advance ────────────────────────────────────────────

  async function handleFormUrlNext() {
    if (!formUrl.trim()) return;
    await handleFetchHeaders(formUrl.trim());
  }

  // ── Import file ───────────────────────────────────────────────────────────

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
      const { updated: updatedList, unchanged, notInSheet, notInFile } = summary;

      setMappingRows((prev) =>
        prev.map((r) => {
          const updated = updatedRows.find((u) => u.header === r.header);
          if (!updated) return r;
          const importedValue: MappingRow = { ...updated };
          const hadRuleChanges = updatedList.some(
            (entry) => entry.header === r.header && entry.ruleDiffs.some((d) => d.status !== "unchanged")
          );
          const base = makeRichRow(updated, r.baseline, undefined, importedValue);
          return { ...base, openOnMount: hadRuleChanges || undefined };
        })
      );

      if (parsed.label && !sheetLabel) setSheetLabel(parsed.label);
      if (parsed.sheet_type) setSheetType(parsed.sheet_type as SheetType);

      const shortMsg = `${updatedList.length} updated, ${unchanged} unchanged, ${notInSheet.length} ignored, ${notInFile.length} untouched`;
      setImportBanner({ variant: "success", message: `Import successful: ${shortMsg}`, summary });
      setTimeout(() => setMappingRows((prev) => prev.map((r) => ({ ...r, openOnMount: undefined }))), 100);
    };
    reader.readAsText(file);
  }

  // ── Build payload ─────────────────────────────────────────────────────────

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

  // ── Save + Sync ───────────────────────────────────────────────────────────

  async function doSaveAndSync() {
    setShowSaveConfirm(false);
    setShowWarningsConfirm(false);
    setSaveLoading(true);
    setStep("syncing");
    try {
      const config = await sheetsApi.createConfig(tournamentId, {
        tournament_id:   tournamentId,
        label:           sheetLabel || validateResult?.spreadsheet_title || "Untitled Sheet",
        sheet_type:      sheetType,
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
    if (dupes.length > 0) { setShowSaveConfirm(true); return; }
    setSaveLoading(true);
    try {
      const validation = await sheetsApi.validateMappings(tournamentId, buildColumnMappings());
      const { ok, shouldConfirm } = handleValidateResult(validation);
      if (!ok) { setShowErrorsModal(true); return; }
      if (shouldConfirm) { setShowWarningsConfirm(true); return; }
      // First attempt with warnings — rows are highlighted, banner shown via validationWarnings
      if (validation.warnings.length > 0) return;
      await doSaveAndSync();
    } catch {
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
        return makeRichRow(next, r.baseline, undefined, r.importedValue, undefined, r.formQuestion);
      })
    );
    const header = mappingRows[idx]?.header;
    if (header) clearRow(header);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const changedCount    = mappingRows.filter((r) => r.state === "changed").length;
  const wizardSteps     = getWizardSteps(sheetType);
  const indicatorStep   = step === "syncing" ? "mapping" : step;
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
        Connect a Google Sheet to import volunteer or event data.
      </p>

      {step !== "syncing" && <StepIndicator steps={wizardSteps} current={indicatorStep} />}

      {/* ── STEP 1: Sheet URL ── */}
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

      {/* ── STEP 2: Tab + Type ── */}
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
                {SHEET_TYPES.map(({ value, label, description }) => (
                  <RadioOption
                    key={value}
                    name="sheet_type"
                    value={value}
                    checked={sheetType === value}
                    onChange={(v) => setSheetType(v as SheetType)}
                    label={label}
                    description={description}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="secondary" size="lg" onClick={() => setStep("url")}>Back</Button>
            <Button variant="primary" size="lg" disabled={!selectedSheet} onClick={handleSheetSelectNext}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Form URL (volunteers only) ── */}
      {step === "form-url" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
              NEXUS uses your Google Form to understand the question types and answer options in your sheet.
              This allows it to auto-suggest field mappings and clean up option text automatically.
            </p>
          </div>

          <Input
            label="Google Form URL"
            type="url"
            placeholder="https://docs.google.com/forms/d/..."
            value={formUrl}
            onChange={(e) => { setFormUrl(e.target.value); setFormUrlError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && formUrl.trim()) handleFormUrlNext(); }}
            error={formUrlError}
            helper="Make sure the form is shared with the NEXUS service account. This is the same email you shared your sheet with."
            fullWidth
            autoFocus
          />

          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="secondary" size="lg" onClick={() => setStep("sheet-select")}>Back</Button>
            <Button
              variant="primary"
              size="lg"
              loading={formUrlLoading}
              disabled={!formUrl.trim()}
              onClick={handleFormUrlNext}
            >
              Next — Map Columns
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Column Mapping ── */}
      {step === "mapping" && headersResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {(validationErrors.length > 0 || validationWarnings.length > 0) && (
            <div>
              {renderErrorBanner()}
              {validationErrors.length === 0 && validationWarnings.length > 0 && (
                <Banner
                  variant="warning"
                  message={`${validationWarnings.length} warning${validationWarnings.length !== 1 ? "s" : ""} — review highlighted rows. Click Save & Sync again to proceed anyway.`}
                />
              )}
            </div>
          )}

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
              <Button variant="secondary" size="sm" onClick={triggerImport}>Import JSON</Button>
              <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
            </div>
          </div>

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
            validationGeneration={validationGeneration}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {renderErrorBanner()}
            <div style={{ display: "flex", gap: "10px" }}>
              <Button variant="secondary" size="lg" onClick={() => setStep(sheetType === "volunteers" ? "form-url" : "sheet-select")}>Back</Button>
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
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>Importing data from your sheet. This may take a moment.</p>
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

      {/* ── Modals ── */}
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