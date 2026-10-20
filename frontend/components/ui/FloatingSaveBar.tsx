"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FloatingBar } from "@/components/ui/FloatingBar";
import { IconCopy } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/lib/useToast";
import { useBlockNavigation } from "@/lib/useUnsavedChanges";

interface FloatingSaveBarProps {
  visible: boolean;
  saving?: boolean;
  error?: string;
  /** Full text behind a short `error`, opened from a Details link so a long
      server message never grows the bar over the page. */
  errorDetails?: string;
  onSave: () => void;
  onCancel: () => void;
  /** Pathname prefix that counts as staying put — links under it navigate freely. */
  stayWithin?: string;
  /** Current measured fixed-bar footprint; callers reserve this as bottom padding. */
  onHeightChange?: (px: number) => void;
}

export function FloatingSaveBar({
  visible,
  saving,
  error,
  errorDetails,
  onSave,
  onCancel,
  stayWithin,
  onHeightChange,
}: FloatingSaveBarProps) {
  // Wherever this bar is shown for unsaved changes, leaving the page should
  // prompt — no page-specific wiring required.
  useBlockNavigation(visible, stayWithin);
  const [showDetails, setShowDetails] = useState(false);

  return (
    <FloatingBar visible={visible} onHeightChange={onHeightChange}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            You have unsaved changes
          </span>
          {error && (
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: "var(--color-danger)",
                marginTop: "2px",
              }}
            >
              {error}
              {errorDetails && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setShowDetails(true)}
                    style={{
                      font: "inherit",
                      color: "inherit",
                      background: "none",
                      border: "none",
                      padding: 0,
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    Details
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>
      {showDetails && errorDetails && (
        <ErrorDetailsModal details={errorDetails} onClose={() => setShowDetails(false)} />
      )}
    </FloatingBar>
  );
}

function ErrorDetailsModal({ details, onClose }: { details: string; onClose: () => void }) {
  const { show } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      show("Copied error");
    } catch {
      show("Couldn't copy — select the text and copy it instead.", "error");
    }
  }

  return (
    <Modal
      title="Error details"
      onClose={onClose}
      width={640}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" variant="primary" onClick={copy}>
            <IconCopy size={14} /> Copy
          </Button>
        </div>
      }
    >
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: "var(--color-text-secondary)",
          marginBottom: "12px",
        }}
      >
        Nothing was saved. If this keeps happening, copy this and send it to the NEXUS team.
      </p>
      <pre
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--color-text-primary)",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "12px",
          maxHeight: "50vh",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {details}
      </pre>
    </Modal>
  );
}
