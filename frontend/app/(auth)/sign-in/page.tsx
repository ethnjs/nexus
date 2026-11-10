"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { ApiError, authApi, type CodeChallenge, onLocalClock } from "@/lib/api";
import { safeRedirectPath, validateEmail } from "@/lib/auth";
import { loadOpenChallenge, saveChallenge } from "@/lib/codeChallengeStore";

export default function SignInPage() {
  return (
    <Suspense fallback={<LoadingState context="section" />}>
      <SignInContent />
    </Suspense>
  );
}

const challengeKey = (email: string) => `signInChallenge:${email.trim().toLowerCase()}`;

// The Google callback is a redirect, so it hands over the code step in the URL fragment, which
// never reaches a server. With no challenge_token, a code went out under a minute ago.
function readGoogleHandoff(): { email: string; challenge: CodeChallenge | null } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const email = params.get("email");
  if (!email) return null;
  const token = params.get("challenge_token");
  if (!token) return { email, challenge: loadOpenChallenge(challengeKey(email)) };
  return {
    email,
    challenge: onLocalClock({
      challenge_token: token,
      expires_in: Number(params.get("expires_in")),
      resend_in: Number(params.get("resend_in")),
    }),
  };
}

function SignInContent() {
  const [handoff] = useState(readGoogleHandoff);
  const [email, setEmail] = useState(handoff?.email ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>(
    handoff && !handoff.challenge
      ? { form: "We sent you a code less than a minute ago. Wait a minute, then try again." }
      : {},
  );
  const [challenge, setChallenge] = useState<CodeChallenge | null>(handoff?.challenge ?? null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const storageKey = challengeKey(email);

  useEffect(() => {
    if (!handoff) return;
    if (handoff.challenge) saveChallenge(challengeKey(handoff.email), handoff.challenge);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [handoff]);

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
