"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ApiError, Form, FormResponse, formsApi } from "@/lib/api";
import { FormFillFlow } from "@/components/forms/FormFillFlow";
import { FormUpdateFlow } from "@/components/forms/FormUpdateFlow";
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
  // The response this user already gave, if any. A form can only be submitted
  // once — coming back is an update, and only for the questions the TD
  // flagged, so which flow renders depends on whether this resolves.
  const [existing, setExisting] = useState<FormResponse | null>(null);
  const [checkedExisting, setCheckedExisting] = useState(false);

  useEffect(() => {
    formsApi.get(formId)
      .then(setForm)
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : "Failed to load form."));
  }, [formId]);

  useEffect(() => {
    // 404 is the ordinary "hasn't answered yet" case, not a failure.
    formsApi.getMyResponse(formId)
      .then(setExisting)
      .catch(() => setExisting(null))
      .finally(() => setCheckedExisting(true));
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

  if (!form || !checkedExisting) {
    return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><Spinner size="lg" /></div>;
  }

  if (existing) {
    // Nothing left to review — the response stands as submitted, and there's
    // no self-serve way to revise it (see backend/form-edit-lifecycle.md).
    if (existing.pending_updates.length === 0) {
      return (
        <div style={{ padding: "80px 24px", textAlign: "center" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            You&rsquo;ve already completed this form. Ask an organizer if something needs changing.
          </p>
        </div>
      );
    }
    return (
      <FormUpdateFlow
        form={form}
        response={existing}
        onUpdated={() => {
          if (redirect) router.replace(redirect);
          else formsApi.getMyResponse(formId).then(setExisting).catch(() => {});
        }}
      />
    );
  }

  return (
    <FormFillFlow
      form={form}
      successMessage="Your response was saved."
      onComplete={submitResponse}
    />
  );
}
