"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { CredentialsForm } from "@/components/auth/CredentialsForm";
import { LoadingState } from "@/components/ui/LoadingState";
import { ApiError, authApi, type CodeChallenge } from "@/lib/api";
import { safeRedirectPath } from "@/lib/auth";

export default function SignUpPage() {
  return (
    <Suspense fallback={<LoadingState context="section" />}>
      <SignUpContent />
    </Suspense>
  );
}

function SignUpContent() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);

  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const onboardingHref = redirect
    ? `/onboarding?redirect=${encodeURIComponent(redirect)}`
    : "/onboarding";

  async function handleRegister(password: string) {
    setLoading(true);
    setFormError(undefined);

    try {
      setChallenge(await authApi.register({ email, password }));
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? error.message : "Something went wrong :(");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ width: "100%" }}>
      {challenge ? (
        <>
          <AuthHeading title="Verify your email" />
          <CodeEntry
            challenge={challenge}
            email={email}
            submitLabel="Create account"
            onSubmit={async (challengeToken, code) => {
              await authApi.verifyCode(challengeToken, code);
              window.location.href = onboardingHref;
            }}
          />
          <div style={{ marginTop: "20px", textAlign: "center" }}>
            <button
              type="button"
              onClick={() => setChallenge(null)}
              className="link-subtle"
              style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}
            >
              Use a different email
            </button>
          </div>
        </>
      ) : (
        <>
          <AuthHeading
            title="Create your account"
            subtitle="Volunteer at tournaments, or run your own."
          />
          <CredentialsForm
            email={email}
            onEmailChange={setEmail}
            onSubmit={handleRegister}
            submitLabel="Sign up"
            loading={loading}
            formError={formError}
          />
        </>
      )}
    </div>
  );
}
