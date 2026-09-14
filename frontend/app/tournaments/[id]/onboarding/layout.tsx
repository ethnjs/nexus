"use client";

import { Topbar } from "@/components/layout/Topbar";
import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";

export default function TournamentOnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    // dvh so the page ends at the visible viewport, not under a mobile URL bar.
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />
      <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
    </div>
  );
}
