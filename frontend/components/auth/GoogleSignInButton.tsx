"use client";

import { Button } from "@/components/ui/Button";
import { IconGoogle } from "@/components/ui/Icons";

// Navigates rather than submitting: the backend answers with a redirect to Google.
export function GoogleSignInButton({ href }: { href: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      fullWidth
      onClick={() => window.location.assign(href)}
    >
      <IconGoogle size={18} />
      Continue with Google
    </Button>
  );
}
