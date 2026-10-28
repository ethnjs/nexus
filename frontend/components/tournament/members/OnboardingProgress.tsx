"use client";

import { Badge } from "@/components/ui/Badge";
import { HoverCard } from "@/components/ui/HoverCard";
import { IconCheck } from "@/components/ui/Icons";
import { ProgressRing } from "@/components/ui/ProgressRing";
import type { MembershipOnboarding, MembershipOnboardingStep } from "@/lib/api";

const MONO_LABEL = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--color-text-secondary)",
} as const;

/** A member's onboarding as a small ring plus "#/#", with the steps on their
 *  path either on hover (roster, board) or listed underneath (panel). null
 *  (no steps on their path) reads as a dash rather than a misleading 0/0. */
export function OnboardingProgress({
  progress,
  steps = "hover",
}: {
  progress: MembershipOnboarding | null | undefined;
  steps?: "hover" | "inline";
}) {
  if (!progress) return <span style={MONO_LABEL}>—</span>;

  const { completed, total } = progress;
  const done = completed >= total;
  const ring = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      {/* Thick stroke: at 16px the default 8 units is a hairline. */}
      <ProgressRing
        completed={completed}
        total={total}
        size={16}
        strokeWidth={16}
        color={done ? "var(--color-success)" : "var(--color-accent)"}
      />
      <span style={MONO_LABEL}>
        {completed}/{total}
      </span>
    </span>
  );

  if (steps === "inline") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {ring}
        <OnboardingStepList steps={progress.steps} />
      </div>
    );
  }

  return (
    <HoverCard
      width="fit"
      content={
        <>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              marginBottom: "8px",
            }}
          >
            Onboarding · {completed} of {total}
          </p>
          <OnboardingStepList steps={progress.steps} />
        </>
      }
    >
      {ring}
    </HoverCard>
  );
}

function OnboardingStepList({ steps }: { steps: MembershipOnboardingStep[] }) {
  return (
    <ul style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {steps.map((step) => (
        <li key={step.form_id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {step.completed ? (
            <IconCheck size={12} style={{ color: "var(--color-success)" }} />
          ) : (
            <span
              aria-hidden="true"
              style={{
                boxSizing: "border-box",
                flexShrink: 0,
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                border: "1.5px solid var(--color-border-strong)",
              }}
            />
          )}
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: step.completed ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            }}
          >
            {step.name}
          </span>
          {step.status === "archived" && <Badge variant="default">Archived</Badge>}
        </li>
      ))}
    </ul>
  );
}
