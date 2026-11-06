"use client";

import { useState } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError, authApi } from "@/lib/api";
import { validateEmail } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const err = validateEmail(email);
    if (err) {
      setError(err);
      return;
    }

    setError(undefined);
    setLoading(true);
    try {
      await authApi.requestPasswordReset(email);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthHeading
        title="Reset your password"
        subtitle={sent ? undefined : "Enter your email and we'll send you a link to reset it."}
      />

      {sent ? (
        <Banner
          variant="success"
          message="If an account exists for that email, a reset link has been sent."
        />
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}
          noValidate
        >
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
            autoComplete="email"
            error={error}
            fullWidth
          />
          <Button type="submit" loading={loading} fullWidth>
            Send reset link
          </Button>
        </form>
      )}
    </>
  );
}
