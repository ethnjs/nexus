"use client";

import { use, useEffect, useState } from "react";
import { formsApi, Form, ApiError } from "@/lib/api";
import { FormFillFlow } from "@/components/forms/FormFillFlow";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";

// TD-only, read-only-but-simulated view of the form as a respondent would
// see it — must work on draft forms (that's the point of previewing before
// publishing). FormFillFlow's onComplete is left unset, so Submit only ever
// runs validation; no FormResponse is ever created here.
export default function FormPreviewPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params);

  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load form."));
  }, [formId]);

  if (loadError) {
    return (
      <div style={{ padding: "22px 24px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <FormFillFlow
      form={form}
      banner={<Banner variant="info" message="Preview mode — nothing submitted here is saved." />}
      successMessage="This preview is complete — no response was recorded."
    />
  );
}
