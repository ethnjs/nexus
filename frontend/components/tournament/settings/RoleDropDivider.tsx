"use client";

import { memo } from "react";
import { DividerState } from "@/lib/useRoleReorder";

// Always rendered (never removed) so it reserves its space whether active or
// not — the "insert here" indicator this way never shifts surrounding rows,
// unlike a border on the row itself which can flicker between two rows near
// their shared edge.
export const RoleDropDivider = memo(function RoleDropDivider({ state }: { state: DividerState }) {
  return (
    <div style={{ height: "8px", display: "flex", alignItems: "center", padding: "0 4px" }}>
      <div style={{
        height: "2px", width: "100%", borderRadius: "1px",
        background: state === "success" ? "var(--color-success)" : state === "noop" ? "var(--color-border-strong)" : "transparent",
        transition: "background 100ms ease",
      }} />
    </div>
  );
});
