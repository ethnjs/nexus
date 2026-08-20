"use client";

import { Topbar } from "@/components/layout/Topbar";

// Standalone shell for the form builder/preview — deliberately outside
// app/dashboard/ since a form's URL never encodes who owns it (tournament
// vs. chapter), the way a Google Doc's URL doesn't encode its Drive folder.
// Shared by /forms/{formId}/edit and /forms/{formId}/preview.
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />
      {children}
    </div>
  );
}
