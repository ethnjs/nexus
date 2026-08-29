"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { membershipsApi, ApiError, MembershipMe, Tournament } from "@/lib/api";

interface AgeDisclosureModalProps {
  tournamentId: number;
  tournament: Tournament | null;
  onResolved: (updated: MembershipMe) => void;
}

function thresholdCopy(tournament: Tournament | null): string {
  if (tournament?.collect_is_over_18 && tournament?.collect_is_over_21) {
    return "whether you are 18 or older and 21 or older";
  }
  if (tournament?.collect_is_over_21) return "whether you are 21 or older";
  return "whether you are 18 or older";
}

// Blocking — no close button, no click-outside, no Esc (onClose is a
// no-op and closeOnOverlayClick is off). A member must answer before doing
// anything else in this tournament.
export function AgeDisclosureModal({ tournamentId, tournament, onResolved }: AgeDisclosureModalProps) {
  const router = useRouter();
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function respond(consent: boolean) {
    setSubmitting(true);
    setError(undefined);
    try {
      const updated = await membershipsApi.setAgeDisclosure(tournamentId, consent);
      if (!consent) {
        // Declining blocks this tournament's pages (see TASK.md 2.4d) — the
        // member has nowhere left to go here.
        router.replace("/dashboard");
        return;
      }
      onResolved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Age disclosure" onClose={() => {}} closeOnOverlayClick={false} width={440}>
      {!confirmingDecline ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            This tournament asks {thresholdCopy(tournament)}. It only sees whether you meet the
            threshold — your date of birth is never shared.
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            You need to answer before continuing.
          </p>
          {error && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="secondary" fullWidth onClick={() => setConfirmingDecline(true)} disabled={submitting}>
              Decline
            </Button>
            <Button fullWidth loading={submitting} onClick={() => respond(true)}>
              Allow
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            Declining removes your access to this tournament, but your existing responses
            (availability, lunch, track statuses, and event preferences) stay on file. You can
            come back any time by allowing.
          </p>
          {error && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="secondary" fullWidth onClick={() => setConfirmingDecline(false)} disabled={submitting}>
              Go back
            </Button>
            <Button variant="danger" fullWidth loading={submitting} onClick={() => respond(false)}>
              Yes, decline
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
