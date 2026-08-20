"use client";

import { use } from "react";

export default function FormEditPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);

  return (
    <div style={{ padding: "22px 24px" }}>
      <p style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-secondary)" }}>
        Form builder — {formId}
      </p>
    </div>
  );
}
