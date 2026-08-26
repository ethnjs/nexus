"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ApiError, Form, formsApi } from "@/lib/api";
import { FormFillFlow } from "@/components/forms/FormFillFlow";
import { Spinner } from "@/components/ui/Spinner";

// Respondent-facing form renderer. `redirect` is optional so this can serve
// direct form links too; only an app-relative path is honored to avoid making
// form submissions an open-redirect vector.
function internalRedirect(value: string | null): string | null {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

export default function FormViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const formId = String(params.formId);
  const redirect = useMemo(() => internalRedirect(searchParams.get("redirect")), [searchParams]);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : "Failed to load form."));
  }, [formId]);

  async function submitResponse(answers: Record<string, unknown>) {
    await formsApi.submitResponse(
      formId,
      Object.entries(answers).map(([field_id, value]) => ({ field_id, value })),
    );
    if (redirect) router.replace(redirect);
  }

  if (loadError) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{loadError}</p>
      </div>
    );
  }

  if (!form) {
    return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
  }

  return (
    <FormFillFlow
      form={form}
      successMessage="Your response was saved."
      onComplete={submitResponse}
    />
  );
}
