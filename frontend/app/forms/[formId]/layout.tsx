"use client";

import { Topbar } from "@/components/layout/Topbar";
import { useAuth } from "@/lib/useAuth";
import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";

// Standalone shell for every /forms/{formId}/ page, outside app/dashboard/
// since a form's URL never encodes who owns it (tournament vs. chapter).
// UnsavedChangesProvider is mounted here because the dashboard's isn't, and
// without one FloatingSaveBar's navigation blocking silently no-ops.
export default function FormLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    // dvh so the page ends at the visible viewport, not under a mobile URL bar.
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      {/* Held back until a user is confirmed: signed out only reaches a shared
          /view link, whose sign-in card is a full page. */}
      {user && <Topbar showWordmark showAvatar />}
      <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
    </div>
  );
}
