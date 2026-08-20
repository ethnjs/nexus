"use client";

import { use } from "react";

// TD-only, read-only-but-simulated view of the form as a respondent would
// see it — must work on draft forms (that's the point of previewing before
// publishing). No FormResponse is created here. Content lands once
// QuestionRenderer's interactive mode is built.
export default function FormPreviewPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);

  return (
    <div style={{ padding: "22px 24px" }}>
      <p style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-secondary)" }}>
        Form preview — {formId}
      </p>
    </div>
  );
}
