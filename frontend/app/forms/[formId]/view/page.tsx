"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ApiError, Form, FormResponse, formsApi } from "@/lib/api";
import { formatDateTime } from "@/lib/timeFormat";
import { ExistingResponse, FormFillFlow } from "@/components/forms/FormFillFlow";
import { ResponseAnswers, wasEdited } from "@/components/forms/ResponseAnswers";
import { Banner } from "@/components/ui/Banner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconEdit, IconLock } from "@/components/ui/Icons";
import styles from "@/components/forms/FormFlow.module.css";

// Respondent-facing form page, one URL for every state of a member's response:
// - no response yet: fill the form
// - responded: read-only view of their answers, with an Edit button
// - ?edit=true: revise them, when the form allows (otherwise the param is dropped)
// One page rather than three because all of them load the same form and
// response behind the same access check, and they hand off to each other —
// submit or save lands back on the read-only view.
//
// `redirect` is optional so this can serve direct form links too; only an
// app-relative path is honored to avoid making form submissions an
// open-redirect vector.
function internalRedirect(value: string | null): string | null {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

const NOT_ACCEPTING = "This form isn't accepting changes right now.";
const EDITS_LOCKED = "Editing is locked. Contact your tournament director if something needs changing.";

export default function FormViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const formId = String(params.formId);
  const redirect = useMemo(() => internalRedirect(searchParams.get("redirect")), [searchParams]);
  const editRequested = searchParams.get("edit") === "true";
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [existing, setExisting] = useState<FormResponse | null>(null);
  const [checkedExisting, setCheckedExisting] = useState(false);
  // Shown on the read-only view after a submit or save lands there.
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

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

  // Why Edit is unavailable, or undefined when it's open. Flagged questions
  // open it even with edits off — the TD asked for those answers again.
  const editLockedReason = useMemo(() => {
    if (!form || !existing) return undefined;
    if (form.status !== "published" || form.tournament_is_archived) return NOT_ACCEPTING;
    if (!form.allow_response_edits && existing.pending_updates.length === 0) return EDITS_LOCKED;
    return undefined;
  }, [form, existing]);

  const editing = editRequested && !!existing && !editLockedReason;

  // ?edit=true that can't be honored falls back to the read-only view; drop
  // the param so the URL says what's on screen and a refresh doesn't re-ask.
  useEffect(() => {
    if (!form || !checkedExisting || !editRequested || editing) return;
    router.replace(`/forms/${formId}/view`);
  }, [form, checkedExisting, editRequested, editing, formId, router]);

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

  // Both writes land back on the read-only view (unless a redirect says otherwise).
  async function afterWrite(message: string) {
    if (redirect) {
      router.replace(redirect);
      return;
    }
    setExisting(await formsApi.getMyResponse(formId));
    setSavedMessage(message);
    router.replace(`/forms/${formId}/view`);
  }

  async function submitResponse(answers: Record<string, unknown>) {
    await formsApi.submitResponse(
      formId,
      Object.entries(answers).map(([field_id, value]) => ({ field_id, value })),
    );
    await afterWrite("Your response was saved.");
  }

  async function patchResponse(changed: Record<string, unknown>) {
    await formsApi.patchResponse(
      formId,
      Object.entries(changed).map(([field_id, value]) => ({ field_id, value })),
    );
    await afterWrite("Your changes were saved.");
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

  if (existing && existingResponse && editing) {
    const flaggedCount = existing.pending_updates.length;
    return (
      <FormFillFlow
        // A fresh flow per saved version, so its prefilled state can't go stale.
        key={existing.updated_at}
        form={form}
        existing={existingResponse}
        banner={flaggedCount > 0 ? (
          <Banner
            variant="warning"
            message={flaggedCount === 1
              ? "One question changed since you answered. Please take another look."
              : `${flaggedCount} questions changed since you answered. Please take another look.`}
          />
        ) : undefined}
        successMessage="Your changes were saved."
        onComplete={patchResponse}
      />
    );
  }

  if (existing) {
    const fields = form.fields.filter((f) => !f.is_archived);
    return (
      <div className={styles.page}>
        {savedMessage && <Banner variant="success" message={savedMessage} />}

        {(form.title || form.description) && (
          <Card radius="lg" className={styles.card}>
            {form.title && (
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", color: "var(--color-text-primary)" }}>
                {form.title}
              </h1>
            )}
            {form.description && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
                {form.description}
              </p>
            )}
          </Card>
        )}

        <Card radius="lg" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "14px 20px", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              Your response
            </div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
              Submitted {formatDateTime(existing.submitted_at)}
              {wasEdited(existing) && ` · Updated ${formatDateTime(existing.updated_at)}`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {editLockedReason && (
              <Tooltip variant="info" message={editLockedReason} showIcon={false}>
                <Badge variant="removed"><IconLock size={11} /> Locked</Badge>
              </Tooltip>
            )}
            <Button
              type="button" variant="secondary" size="md"
              disabled={!!editLockedReason}
              title={editLockedReason}
              onClick={() => { setSavedMessage(null); router.push(`/forms/${formId}/view?edit=true`); }}
            >
              <IconEdit size={14} /> Edit response
            </Button>
          </div>
        </Card>

        <ResponseAnswers fields={fields} answers={existing.answers} />
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

  return (
    <FormFillFlow
      form={form}
      successMessage="Your response was saved."
      onComplete={submitResponse}
    />
  );
}
