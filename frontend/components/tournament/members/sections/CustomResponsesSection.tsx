"use client";

import { FieldGrid, FieldValue, PanelField } from "@/components/profile/PanelField";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { SectionHeading } from "@/components/profile/SectionHeading";
import type { MembershipCustomAnswer } from "@/lib/api";
import { unslug } from "@/lib/textFormat";

interface CustomResponsesSectionProps {
  customResponses: MembershipCustomAnswer[];
  /** Heading text — a TD-made section supplies its own name. */
  title?: string;
}

// A submitted select-type answer is frozen as an option snapshot
// ({option_id, value, label}) so a later edit to the option's text doesn't
// rewrite history — see snapshot_answer_value. Only `value` is meant to be
// read; rendering the raw object dumped the whole JSON into the panel.
function isOptionSnapshot(v: unknown): v is { value?: unknown; label?: unknown } {
  return typeof v === "object" && v !== null && "option_id" in v;
}

function optionText(v: unknown): string {
  if (isOptionSnapshot(v)) return String(v.value ?? v.label ?? "");
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

// Covers the shapes snapshot_answer_value produces — a lone option, a list of
// them (multi_select_checkbox), a rank -> option map (ranked_choice) and a
// row -> option(s) map (grids, named through `rows`) — plus plain text
// answers, which pass through untouched.
function formatValue({ value, rows }: MembershipCustomAnswer): string {
  if (value === null || value === undefined || value === "") return "—";
  if (rows) {
    const byRow = value as Record<string, unknown>;
    const answered = rows.filter((row) => byRow[row.option_id] !== undefined);
    if (answered.length === 0) return "—";
    return answered
      .map((row) => {
        const picked = byRow[row.option_id];
        const text = Array.isArray(picked) ? picked.map(optionText).join(", ") : optionText(picked);
        return `${row.label}: ${text}`;
      })
      .join("; ");
  }
  if (Array.isArray(value)) return value.length > 0 ? value.map(optionText).join(", ") : "—";
  if (isOptionSnapshot(value)) return optionText(value);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "—";
    // Ranked choice: the key is the rank, so it belongs in the output.
    return entries
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([rank, option]) => `${rank}. ${optionText(option)}`)
      .join(", ");
  }
  return String(value);
}

export function CustomResponsesSection({
  customResponses,
  title = "Custom Responses",
}: CustomResponsesSectionProps) {
  return (
    <ProfileCard>
      <SectionHeading title={title}>
        {customResponses.length === 0 && <FieldValue muted>No info yet</FieldValue>}
        <FieldGrid>
          {customResponses.map((answer, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list, never reordered
            <PanelField key={i} label={unslug(answer.field_key)}>
              <FieldValue>{formatValue(answer)}</FieldValue>
            </PanelField>
          ))}
        </FieldGrid>
      </SectionHeading>
    </ProfileCard>
  );
}
