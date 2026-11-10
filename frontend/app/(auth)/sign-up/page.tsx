"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { CredentialsForm } from "@/components/auth/CredentialsForm";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, authApi, type CodeChallenge } from "@/lib/api";
import { safeRedirectPath } from "@/lib/auth";

export default function SignUpPage() {
  return (
    <Suspense fallback={<Spinner size="lg" />}>
      <SignUpContent />
    </Suspense>
  );
}

function SignUpContent() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const signInHref = redirect ? `/sign-in?redirect=${encodeURIComponent(redirect)}` : "/sign-in";
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
      <h2
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "28px",
          fontWeight: "700",
          color: "var(--color-text-primary)",
          margin: "0 0 30px",
          textAlign: "center",
        }}
      >
        {challenge ? "Verify your email" : "Sign Up"}
      </h2>

      {challenge ? (
        <CodeEntry
          challenge={challenge}
          email={email}
          submitLabel="Create account"
          onSubmit={async (challengeToken, code) => {
            await authApi.verifyCode(challengeToken, code);
            window.location.href = onboardingHref;
          }}
        />
      ) : (
        <CredentialsForm
          email={email}
          onEmailChange={setEmail}
          onSubmit={handleRegister}
          submitLabel="Sign Up"
          loading={loading}
          formError={formError}
        />
      )}

      <div style={{ marginTop: "20px", textAlign: "center" }}>
        {challenge ? (
          <button
            type="button"
            onClick={() => setChallenge(null)}
            className="link-subtle"
            style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}
          >
            Use a different email
          </button>
        ) : (
          <>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--color-text-secondary)",
              }}
            >
              Already have an account?{" "}
            </span>
            <button
              type="button"
              onClick={() => router.push(signInHref)}
              className="link-subtle"
              style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
