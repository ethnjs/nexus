"use client";

import { MembershipCustomAnswer } from "@/lib/api";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { PanelField } from "@/components/tournament/PanelField";

interface CustomResponsesSectionProps {
  customResponses: MembershipCustomAnswer[];
}

// Groups flat custom-answer rows by their source form, preserving first-seen
// form order — MembershipFullResponse doesn't group these itself since a
// membership can carry answers from several forms.
function groupByForm(answers: MembershipCustomAnswer[]): [string, MembershipCustomAnswer[]][] {
  const byForm = new Map<string, MembershipCustomAnswer[]>();
  for (const answer of answers) {
    const group = byForm.get(answer.form_title);
    if (group) group.push(answer);
    else byForm.set(answer.form_title, [answer]);
  }
  return Array.from(byForm.entries());
}

// A custom answer's value shape depends on the field's question_type (plain
// text, a list of selected option labels, etc.) — there's no read-only
// response renderer elsewhere to reuse yet, so this just covers the common
// shapes generically rather than switching on every question_type.
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function CustomResponsesSection({ customResponses }: CustomResponsesSectionProps) {
  if (customResponses.length === 0) return null;

  return (
    <ProfileCard>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "4px",
      }}>
        Custom Responses
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {groupByForm(customResponses).map(([formTitle, answers]) => (
          <div key={formTitle}>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600,
              color: "var(--color-text-secondary)", marginBottom: "8px",
            }}>
              {formTitle}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {answers.map((a, i) => (
                <PanelField key={i} label={a.field_label}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {formatValue(a.value)}
                  </span>
                </PanelField>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ProfileCard>
  );
}
