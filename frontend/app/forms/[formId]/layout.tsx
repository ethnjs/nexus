"use client";

import { Topbar } from "@/components/layout/Topbar";
import { UnsavedChangesProvider } from "@/lib/useUnsavedChanges";

// Standalone shell for the form builder/preview — deliberately outside
// app/dashboard/ since a form's URL never encodes who owns it (tournament
// vs. chapter), the way a Google Doc's URL doesn't encode its Drive folder.
// Shared by /forms/{formId}/edit and /forms/{formId}/preview.
// UnsavedChangesProvider is mounted here rather than assumed from the
// dashboard layout — this route tree sits outside app/dashboard/, so
// FloatingSaveBar's useBlockNavigation would otherwise silently no-op
// (the default context is a pass-through, not an error).
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />
      <UnsavedChangesProvider>
        {children}
      </UnsavedChangesProvider>
    </div>
  );
}
