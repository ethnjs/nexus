'use client'

import { ValidationIssue } from "@/lib/api";
import { Button } from "@/components/ui/Button";

// ─── Shared issue card ────────────────────────────────────────────────────────

function IssueCard({ issue, variant }: { issue: ValidationIssue; variant: "error" | "warning" }) {
  const isError  = variant === "error";
  const bg       = isError ? "#FFF5F5" : "#FFFBEB";
  const border   = isError ? "#FCA5A5" : "#FDE047";

  const headers: string[] = Array.isArray(issue.header)
    ? issue.header
    : issue.header
    ? [issue.header]
    : [];

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
      {(headers.length > 0 || issue.rule_index != null) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px", alignItems: "center" }}>
          {headers.map((h, i) => (
            <span key={i} style={{
              fontFamily:   "var(--font-mono)",
              fontSize:     "10px",
              color:        "var(--color-text-secondary)",
              background:   "var(--color-surface)",
              border:       "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              padding:      "1px 7px",
              whiteSpace:   "nowrap",
              maxWidth:     "340px",
              overflow:     "hidden",
              textOverflow: "ellipsis",
            }}>
              {h}
            </span>
          ))}
          {issue.rule_index != null && (
            <span style={{
              fontFamily:   "var(--font-sans)",
              fontSize:     "10px",
              fontWeight:   600,
              color:        "var(--color-text-tertiary)",
              whiteSpace:   "nowrap",
            }}>
              Rule {issue.rule_index + 1}
            </span>
          )}
        </div>
      )}
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)", margin: 0 }}>
        {issue.message}
      </p>
    </div>
  );
}

// ─── Shared section label ─────────────────────────────────────────────────────

function SectionLabel({ children, color, topMargin }: { children: React.ReactNode; color: string; topMargin?: boolean }) {
  return (
    <p style={{
      fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.07em",
      color, marginTop: topMargin ? "8px" : 0, marginBottom: "2px",
    }}>
      {children}
    </p>
  );
}

// ─── Shared backdrop + panel ──────────────────────────────────────────────────

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "28px", width: 640, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", gap: "16px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Issue list (shared) ──────────────────────────────────────────────────────

function IssueList({ errors, warnings }: { errors: ValidationIssue[]; warnings: ValidationIssue[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "360px", overflowY: "auto" }}>
      {errors.length > 0 && (
        <>
          <SectionLabel color="var(--color-danger)">Errors</SectionLabel>
          {errors.map((e, i) => <IssueCard key={`e${i}`} issue={e} variant="error" />)}
        </>
      )}
      {warnings.length > 0 && (
        <>
          <SectionLabel color="#92400E" topMargin={errors.length > 0}>Warnings</SectionLabel>
          {warnings.map((w, i) => <IssueCard key={`w${i}`} issue={w} variant="warning" />)}
        </>
      )}
    </div>
  );
}

// ─── X close button ───────────────────────────────────────────────────────────

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "var(--color-text-tertiary)", flexShrink: 0, lineHeight: 1 }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-primary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
      aria-label="Close"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// ─── Errors modal (read-only, X to close) ────────────────────────────────────

interface ValidationErrorsModalProps {
  errors:   ValidationIssue[];
  warnings: ValidationIssue[];
  onClose:  () => void;
}

export function SheetMappingValidationErrorsModal({ errors, warnings, onClose }: ValidationErrorsModalProps) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "4px" }}>
            Fix before syncing
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {errors.length} error{errors.length !== 1 ? "s" : ""}
            {warnings.length > 0 ? ` and ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}` : ""} found.
            Errors must be fixed before saving.
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <IssueList errors={errors} warnings={warnings} />
    </ModalShell>
  );
}

// ─── Warnings confirm modal (Go back / Sync anyway) ──────────────────────────

interface ValidationWarningsModalProps {
  warnings:  ValidationIssue[];
  onConfirm: () => void;
  onCancel:  () => void;
}

export function SheetMappingValidationWarningsModal({ warnings, onConfirm, onCancel }: ValidationWarningsModalProps) {
  return (
    <ModalShell onClose={onCancel}>
      <div>
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", marginBottom: "6px" }}>
          Sync with warnings?
        </h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          There are no blocking errors, but the following warnings were found. Review them before syncing.
        </p>
      </div>
      <IssueList errors={[]} warnings={warnings} />
      <div style={{ display: "flex", gap: "10px" }}>
        <Button variant="secondary" size="md" fullWidth onClick={onCancel}>Go back</Button>
        <Button variant="primary"   size="md" fullWidth onClick={onConfirm}>Sync anyway</Button>
      </div>
    </ModalShell>
  );
}