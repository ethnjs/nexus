"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, authApi, type CodeChallenge } from "@/lib/api";
import { safeRedirectPath, validateEmail } from "@/lib/auth";
import { loadOpenChallenge, saveChallenge } from "@/lib/codeChallengeStore";

export default function SignInPage() {
  return (
    <Suspense fallback={<Spinner size="lg" />}>
      <SignInContent />
    </Suspense>
  );
}

function SignInContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const storageKey = `signInChallenge:${email.trim().toLowerCase()}`;

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const emailError = validateEmail(email);
    const passwordError = !password ? "Cannot be empty." : null;

    if (emailError || passwordError) {
      setErrors({ email: emailError ?? undefined, password: passwordError ?? undefined });
      setLoading(false);
      return;
    }

    try {
      const res = await authApi.login(email, password);
      if (res.challenge) {
        saveChallenge(storageKey, res.challenge);
        setChallenge(res.challenge);
        return;
      }
      window.location.href = redirect ?? "/dashboard";
    } catch (error: unknown) {
      // A 429 comes only after a correct password, when this account's code went out under a
      // minute ago. If that was from this tab, reopen it: the emailed code still works.
      const last =
        error instanceof ApiError && error.status === 429 && loadOpenChallenge(storageKey);
      if (last) {
        setChallenge(last);
      } else if (error instanceof ApiError) {
        setErrors({ form: error.message });
      } else {
        setErrors({ form: "Something went wrong :(" });
      }
    } finally {
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <div style={{ width: "100%" }}>
        <AuthHeading title="Check your email" />
        <CodeEntry
          challenge={challenge}
          email={email}
          submitLabel="Sign in"
          onClosed={() => saveChallenge(storageKey, null)}
          onSubmit={async (challengeToken, code) => {
            await authApi.verifyCode(challengeToken, code);
            saveChallenge(storageKey, null);
            window.location.href = redirect ?? "/dashboard";
          }}
        />
        <div style={{ marginTop: "20px", textAlign: "center" }}>
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setPassword("");
            }}
            className="link-subtle"
            style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <AuthHeading title="Welcome back" subtitle="Sign in to your account." />

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <Input
          font="sans"
          label="Email"
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((er) => ({ ...er, email: undefined }));
          }}
          autoComplete="email"
          autoFocus
          error={errors.email}
          fullWidth
        />
        {/* The link comes after the field in the DOM, so Tab reaches the
            password first, and is placed back onto the label row. */}
        <div style={{ position: "relative" }}>
          <Input
            font="sans"
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((er) => ({ ...er, password: undefined }));
            }}
            autoComplete="current-password"
            error={errors.password}
            fullWidth
          />
          <button
            type="button"
            onClick={() => router.push("/forgot-password")}
            className="link-subtle"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              fontFamily: "var(--font-sans)",
              fontSize: "12px",
              lineHeight: "16px",
            }}
          >
            Forgot password?
          </button>
        </div>
        {errors.form && (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              color: "var(--color-danger)",
              margin: 0,
            }}
          >
            {errors.form}
          </p>
        )}
        <Button type="submit" loading={loading} fullWidth style={{ marginTop: "8px" }}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
