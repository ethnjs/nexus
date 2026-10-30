"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { Button } from "@/components/ui/Button";
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, authApi } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={<Spinner size="lg" />}>
      <ConfirmEmailChangeContent />
    </Suspense>
  );
}

function ConfirmEmailChangeContent() {
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | undefined>(undefined);
  const { user } = useAuth();
  const router = useRouter();

  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  useEffect(() => {
    authApi
      .confirmEmailChange(token ?? "")
      .then(() => setState("success"))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Something went wrong");
        setState("error");
      });
  }, [token]);

  return (
    <>
      <AuthHeading title="Confirm email change" />

      {state === "loading" && <Spinner size="lg" />}

      {state === "success" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span
            style={{
              marginBottom: "10px",
              display: "flex",
              gap: "5px",
              alignItems: "center",
              fontFamily: "var(--font-sans)",
              fontSize: "16px",
              color: "var(--color-text-primary)",
            }}
          >
            <IconCheckCircle style={{ color: "var(--color-success)" }} size={16} />
            Your email has been updated.
          </span>
          {user ? (
            <Button onClick={() => router.push("/settings/account")}>
              Back to account settings
            </Button>
          ) : (
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: "var(--color-text-secondary)",
              }}
            >
              You can close this window.
            </span>
          )}
        </div>
      )}

      {state === "error" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span
            style={{
              marginBottom: "10px",
              alignItems: "center",
              display: "flex",
              gap: "6px",
              fontFamily: "var(--font-sans)",
              fontSize: "16px",
              color: "var(--color-text-primary)",
            }}
          >
            <IconXCircle style={{ color: "var(--color-danger)" }} size={16} />
            Error: {error}
          </span>
          {user && (
            <Button onClick={() => router.push("/settings/account")}>
              Back to account settings
            </Button>
          )}
        </div>
      )}
    </>
  );
}
