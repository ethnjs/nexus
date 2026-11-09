"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, authApi, type CodeChallenge } from "@/lib/api";
import { safeRedirectPath, validateEmail } from "@/lib/auth";

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
  const signUpHref = redirect ? `/sign-up?redirect=${encodeURIComponent(redirect)}` : "/sign-up";

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
      if (res.code_required && res.challenge_token && res.expires_at && res.can_resend_at) {
        setChallenge({
          challenge_token: res.challenge_token,
          expires_at: res.expires_at,
          can_resend_at: res.can_resend_at,
        });
        return;
      }
      window.location.href = redirect ?? "/dashboard";
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrors({ form: error.message });
      } else {
        setErrors({ form: "Something went wrong :(" });
      }
    } finally {
      setLoading(false);
    }
  }

  const heading = (
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
      {challenge ? "Check your email" : "Sign In"}
    </h2>
  );

  if (challenge) {
    return (
      <div style={{ width: "100%" }}>
        {heading}
        <CodeEntry
          challenge={challenge}
          email={email}
          submitLabel="Sign In"
          onSubmit={async (challengeToken, code) => {
            await authApi.verifyCode(challengeToken, code);
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
      {heading}

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: "20px" }}
      >
        <Input
          label="Email"
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((er) => ({ ...er, email: undefined }));
          }}
          autoComplete="email"
          error={errors.email}
          fullWidth
        />
        <div>
          <Input
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
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
            <button
              type="button"
              onClick={() => router.push("/forgot-password")}
              className="link-subtle"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
              }}
            >
              Forgot password?
            </button>
          </div>
        </div>
        <Button type="submit" loading={loading} fullWidth>
          Sign In
        </Button>

        <div>
          {errors.form && (
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                color: "var(--color-danger)",
              }}
            >
              {errors.form}
            </p>
          )}
        </div>
      </form>

      <div style={{ marginTop: "20px", textAlign: "center" }}>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          Don&rsquo;t have an account?{" "}
        </span>
        <button
          type="button"
          onClick={() => router.push(signUpHref)}
          className="link-subtle"
          style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600 }}
        >
          Sign up
        </button>
      </div>
    </div>
  );
}
