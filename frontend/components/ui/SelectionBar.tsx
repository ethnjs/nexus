"use client";

import { Button } from "@/components/ui/Button";
import { IconX } from "@/components/ui/Icons";

interface SelectionBarProps {
  visible: boolean;
  count: number;
  editLabel?: string;
  onEdit: () => void;
  onCancel: () => void;
}

// Floating bar shown while a table is in select mode — mirrors
// FloatingSaveBar's fixed-bottom-center slide-in pattern, but for acting on
// a set of selected rows instead of unsaved form state.
export function SelectionBar({ visible, count, editLabel = "Edit", onEdit, onCancel }: SelectionBarProps) {
  return (
    <div style={{
      position: "fixed", left: "50%", bottom: visible ? "24px" : "-80px",
      transform: "translateX(-50%)",
      width: "min(360px, calc(100vw - 40px))",
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
      padding: "10px 10px 10px 18px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
      transition: "bottom 0.25s ease",
      zIndex: 60,
    }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {count} selected
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <Button type="button" variant="primary" size="sm" disabled={count === 0} onClick={onEdit}>
          {editLabel}
        </Button>
        <Button type="button" variant="secondary" size="sm" iconOnly title="Cancel selection" onClick={onCancel}>
          <IconX size={13} />
        </Button>
      </div>
    </div>
  );
}
