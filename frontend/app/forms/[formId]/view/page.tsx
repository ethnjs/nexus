"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ApiError, Form, FormResponse, formsApi } from "@/lib/api";
import { ExistingResponse, FormFillFlow } from "@/components/forms/FormFillFlow";
import { Banner } from "@/components/ui/Banner";
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
  // once — coming back is a revision: of every question when the form allows
  // edits, otherwise only of the ones the TD flagged.
  const [existing, setExisting] = useState<FormResponse | null>(null);
  const [checkedExisting, setCheckedExisting] = useState(false);
  // Set after a revision saves. The flow remounts on the refreshed response
  // (its key), so the confirmation lives here rather than inside it.
  const [saved, setSaved] = useState(false);

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

  const existingResponse = useMemo<ExistingResponse | null>(() => {
    if (!form || !existing) return null;
    const flagged = new Map(existing.pending_updates.map((p) => [p.field_id, p.reasons]));
    return {
      stored: Object.fromEntries(existing.answers.map((a) => [a.field_id, a.value])),
      editableIds: form.allow_response_edits
        ? new Set(form.fields.filter((f) => !f.is_archived).map((f) => f.id))
        : new Set(flagged.keys()),
      flagged,
    };
  }, [form, existing]);

  async function patchResponse(changed: Record<string, unknown>) {
    await formsApi.patchResponse(
      formId,
      Object.entries(changed).map(([field_id, value]) => ({ field_id, value })),
    );
    if (redirect) {
      router.replace(redirect);
      return;
    }
    setExisting(await formsApi.getMyResponse(formId));
    setSaved(true);
  }

  const savedBanner = saved ? <Banner variant="success" message="Your changes were saved." /> : null;

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

  // Nothing to revise — edits are off and nothing is flagged, so the response
  // stands as submitted (see backend/form-edit-lifecycle.md).
  if (existing && !form.allow_response_edits && existing.pending_updates.length === 0) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
        {savedBanner}
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          You&rsquo;ve already completed this form. Ask an organizer if something needs changing.
        </p>
      </div>
    );
  }

  // A manager can still open a draft/archived form here, and an archived
  // tournament freezes every form — say so up front rather than letting
  // someone fill it out only to have the submit rejected.
  if (form.status !== "published" || form.tournament_is_archived) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          This form isn&rsquo;t accepting responses right now.
        </p>
      </div>
    );
  }

  if (existingResponse && existing) {
    const flaggedCount = existing.pending_updates.length;
    return (
      <FormFillFlow
        // A fresh flow per saved version, so its prefilled state can't go stale.
        key={existing.updated_at}
        form={form}
        existing={existingResponse}
        banner={<>
          {savedBanner}
          {flaggedCount > 0 && (
            <Banner
              variant="warning"
              message={flaggedCount === 1
                ? "One question changed since you answered. Please take another look."
                : `${flaggedCount} questions changed since you answered. Please take another look.`}
            />
          )}
        </>}
        successMessage="Your changes were saved."
        onComplete={patchResponse}
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
