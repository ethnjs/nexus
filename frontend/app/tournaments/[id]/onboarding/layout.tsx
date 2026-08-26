"use client";

import { Topbar } from "@/components/layout/Topbar";
import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";

export default function TournamentOnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />
      <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
    </div>
  );
}
