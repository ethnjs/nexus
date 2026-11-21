"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthHeading } from "@/components/auth/AuthHeading";
import { LoadingState } from "@/components/ui/LoadingState";

export default function AccountUnavailablePage() {
  return (
    <Suspense fallback={<LoadingState context="section" />}>
      <AccountUnavailableContent />
    </Suspense>
  );
}

function AccountUnavailableContent() {
  const locked = useSearchParams().get("reason") === "locked";

  return (
    <AuthHeading
      title={locked ? "Your account is locked" : "Account unavailable"}
      subtitle={
        locked ? (
          <>
            If you entered your date of birth by mistake, email{" "}
            <a href="mailto:support@nexus.socalscioly.org" className="link-subtle">
              support@nexus.socalscioly.org
            </a>{" "}
            within 14 days.
          </>
        ) : (
          "We can't create an account for you."
        )
      }
    />
  );
}
