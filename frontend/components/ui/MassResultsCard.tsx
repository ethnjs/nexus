"use client";

import { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

export interface MassResult {
  key: string | number;
  label: ReactNode;
  error?: string;
}

/** Per-row outcome of a mass edit — shared by the events and shifts editors. */
export function MassResultsCard({ results }: { results: MassResult[] }) {
  const failureCount = results.filter((r) => r.error).length;
  const successCount = results.length - failureCount;
  return (
    <Card radius="lg" style={{ padding: "16px 20px", marginBottom: "24px" }}>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)",
        marginBottom: "10px",
      }}>
        {successCount} saved, {failureCount} failed
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {results.map((r) => (
          <p key={r.key} style={{ fontFamily: "var(--font-sans)", fontSize: "12px" }}>
            <span style={{ fontWeight: 500 }}>{r.label}</span>{" "}
            {r.error ? (
              <span style={{ color: "var(--color-danger)" }}>— {r.error}</span>
            ) : (
              <span style={{ color: "var(--color-success)" }}>— saved</span>
            )}
          </p>
        ))}
      </div>
    </Card>
  );
}
