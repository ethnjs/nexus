"use client";

import { MembershipOnboarding } from "@/lib/api";
import { ProgressRing } from "@/components/ui/ProgressRing";

/** A member's onboarding as a small ring plus "#/#" — shared by the roster
 *  column and the panel's Membership section. null (no live onboarding steps)
 *  reads as a dash rather than a misleading 0/0. */
export function OnboardingProgress({ progress }: { progress: MembershipOnboarding | null | undefined }) {
  if (!progress) {
    return <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>—</span>;
  }
  const { completed, total } = progress;
  const done = completed >= total;

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
      title={`${completed} of ${total} onboarding form${total === 1 ? "" : "s"} completed`}
    >
      {/* Thick stroke: at 16px the default 8 units is a hairline. */}
      <ProgressRing
        completed={completed} total={total} size={16} strokeWidth={16}
        color={done ? "var(--color-success)" : "var(--color-accent)"}
      />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {completed}/{total}
      </span>
    </span>
  );
}
