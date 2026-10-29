"use client";

import { notFound, useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type ExistingResponse, FormFillFlow } from "@/components/forms/FormFillFlow";
import styles from "@/components/forms/FormFlow.module.css";
import { NoFormAccess } from "@/components/forms/NoFormAccess";
import { ResponseAnswers, wasEdited } from "@/components/forms/ResponseAnswers";
import cardStyles from "@/components/layout/CenteredCard.module.css";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormattedText } from "@/components/ui/FormattedText";
import { IconEdit, IconLock } from "@/components/ui/Icons";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { ApiError, type Form, type FormResponse, formsApi } from "@/lib/api";
import { responseEditLockedReason } from "@/lib/forms/responseEditLock";
import { formatDateTime } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";

// Respondent-facing form page, and the link managers share. One URL for every state:
// - signed out: a sign-in card; not a member, a draft, or an archived form
//   they never answered: 404
// - still owes onboarding: sent through the sequence, which returns here
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

type OnboardingRequired = {
  code: "onboarding_required";
  tournament_id: number;
  is_onboarding: boolean;
};

function onboardingRequired(error: unknown): OnboardingRequired | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const detail = error.detail as { code?: unknown } | null;
  return detail?.code === "onboarding_required" ? (detail as OnboardingRequired) : null;
}

// Matches the (auth) pages: a signed-out visitor learns nothing about the form.
function SignInCard({ formId }: { formId: string }) {
  const router = useRouter();
  const redirectParam = `?redirect=${encodeURIComponent(`/forms/${formId}/view`)}`;

  return (
    <div className={cardStyles.page}>
      <section className={cardStyles.card}>
        <h1 className={cardStyles.wordmark}>NEXUS</h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            color: "var(--color-text-secondary)",
            textAlign: "center",
            marginBottom: "24px",
          }}
        >
          Please sign in or create an account to fill out this form.
        </p>
        <div style={{ width: "100%", display: "flex", gap: "10px" }}>
          <Button
            fullWidth
            variant="secondary"
            onClick={() => router.push(`/sign-up${redirectParam}`)}
          >
            Create account
          </Button>
          <Button fullWidth onClick={() => router.push(`/sign-in${redirectParam}`)}>
            Sign in
          </Button>
        </div>
      </section>
    </div>
  );
}

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
  const { user, loading: authLoading } = useAuth();
  const [missing, setMissing] = useState(false);
  const [noAccess, setNoAccess] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    formsApi
      .get(formId)
      .then(setForm)
      .catch((error) => {
        const denied = onboardingRequired(error);
        if (denied) {
          // A step of the sequence is reached along the way, so only come back for other forms.
          const back = denied.is_onboarding
            ? ""
            : `?redirect=${encodeURIComponent(`/forms/${formId}/view`)}`;
          router.replace(`/tournaments/${denied.tournament_id}/onboarding${back}`);
        } else if (error instanceof ApiError && error.status === 404) {
          setMissing(true);
        } else if (error instanceof ApiError && error.status === 403) {
          setNoAccess(true);
        } else {
          setLoadError(error instanceof ApiError ? error.message : "Failed to load form.");
        }
      });
  }, [authLoading, user, formId, router]);

  useEffect(() => {
    if (authLoading || !user) return;
    // 404 is the ordinary "hasn't answered yet" case, not a failure.
    formsApi
      .getMyResponse(formId)
      .then(setExisting)
      .catch(() => setExisting(null))
      .finally(() => setCheckedExisting(true));
  }, [authLoading, user, formId]);

  // Why Edit is unavailable, or undefined when it's open.
  const editLockedReason = useMemo(() => {
    if (!form || !existing) return undefined;
    return responseEditLockedReason({
      status: form.status,
      allow_response_edits: form.allow_response_edits,
      tournamentArchived: !!form.tournament_is_archived,
    });
  }, [form, existing]);

  const editing = editRequested && !!existing && !editLockedReason;

  // ?edit=true that can't be honored falls back to the read-only view; drop
  // the param so the URL says what's on screen and a refresh doesn't re-ask.
  useEffect(() => {
    if (!form || !checkedExisting || !editRequested || editing) return;
    router.replace(`/forms/${formId}/view`);
  }, [form, checkedExisting, editRequested, editing, formId, router]);

  const existingResponse = useMemo<ExistingResponse | null>(() => {
    if (!existing) return null;
    return { stored: Object.fromEntries(existing.answers.map((a) => [a.field_id, a.value])) };
  }, [existing]);

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

  if (authLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return <SignInCard formId={formId} />;
  if (missing) notFound();
  if (noAccess)
    return (
      <NoFormAccess description="This form is only open to some members of the tournament. If you think you should have it, contact the tournament director." />
    );

  if (loadError) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p
          style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}
        >
          {loadError}
        </p>
      </div>
    );
  }

  if (!form || !checkedExisting) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (existing && existingResponse && editing) {
    return (
      <FormFillFlow
        // A fresh flow per saved version, so its prefilled state can't go stale.
        key={existing.updated_at}
        form={form}
        existing={existingResponse}
        successMessage="Your changes were saved."
        onComplete={patchResponse}
      />
    );
  }

  if (existing) {
    return (
      <div className={styles.page}>
        {savedMessage && <Banner variant="success" message={savedMessage} />}

        {(form.title || form.description) && (
          <Card radius="lg" className={styles.card}>
            {form.title && (
              <h1
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "24px",
                  color: "var(--color-text-primary)",
                }}
              >
                <FormattedText markdown={form.title} variant="inline" />
              </h1>
            )}
            {form.description && (
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "14px",
                  color: "var(--color-text-secondary)",
                  marginTop: "8px",
                }}
              >
                <FormattedText markdown={form.description} variant="rich" />
              </div>
            )}
          </Card>
        )}

        <Card
          radius="lg"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "14px 20px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "15px",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Your response
            </div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: "var(--color-text-tertiary)",
                marginTop: "2px",
              }}
            >
              Submitted {formatDateTime(existing.submitted_at)}
              {wasEdited(existing) && ` · Updated ${formatDateTime(existing.updated_at)}`}
            </div>
          </div>
          {editLockedReason ? (
            <Tooltip variant="info" message={editLockedReason} showIcon={false}>
              {/* A disabled button swallows hover in some browsers, so the wrapper takes it. */}
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled
                style={{ pointerEvents: "none" }}
              >
                <IconLock size={14} /> Edit response
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                setSavedMessage(null);
                router.push(`/forms/${formId}/view?edit=true`);
              }}
            >
              <IconEdit size={14} /> Edit response
            </Button>
          )}
        </Card>

        <ResponseAnswers fields={form.fields} answers={existing.answers} />
      </div>
    );
  }

  // A manager can still open a draft/archived form here, and an archived
  // tournament freezes every form — say so up front rather than letting
  // someone fill it out only to have the submit rejected.
  if (form.status !== "published" || form.tournament_is_archived) {
    return (
      <div style={{ padding: "80px 24px", textAlign: "center" }}>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
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
