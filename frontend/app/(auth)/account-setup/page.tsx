"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { CredentialsForm } from "@/components/auth/CredentialsForm";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, authApi } from "@/lib/api";

export default function AccountSetupPage() {
  return (
    <Suspense fallback={<Spinner size="lg" />}>
      <AccountSetupContent />
    </Suspense>
  );
}

function AccountSetupContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  async function handleConfirm(password: string) {
    setLoading(true);
    setFormError(undefined);

    try {
      await authApi.confirmAccountSetup(token, password);

      // Full reload (not router.push) — AuthProvider needs to fetch the
      // now-authenticated session fresh, same reasoning as onboarding/sign-up.
      window.location.href = "/onboarding";
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? error.message : "Something went wrong :(");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          color: "var(--color-danger)",
          textAlign: "center",
        }}
      >
        This link is missing or invalid. Ask whoever invited you to resend it.
      </p>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <AuthHeading
        title="Set up your account"
        subtitle="Choose a password to finish setting up your account."
      />

      <CredentialsForm
        onSubmit={handleConfirm}
        submitLabel="Complete setup"
        loading={loading}
        formError={formError}
      />
    </div>
  );
}
