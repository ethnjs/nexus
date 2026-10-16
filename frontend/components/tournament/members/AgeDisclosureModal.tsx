"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ApiError, type MembershipMe, membersApi, type Tournament } from "@/lib/api";

interface AgeDisclosureModalProps {
  tournamentId: number;
  tournament: Tournament | null;
  onResolved: (updated: MembershipMe) => void;
}

function thresholdCopy(tournament: Tournament | null): string {
  if (tournament?.collect_is_over_18 && tournament?.collect_is_over_21) {
    return "which age group you're in: under 18, 18–20, or 21+";
  }
  if (tournament?.collect_is_over_21) return "which age group you're in: under 21 or 21+";
  return "which age group you're in: under 18 or 18+";
}

// Blocking — no close button, no click-outside, no Esc. A member must answer
// before doing anything else in this tournament.
export function AgeDisclosureModal({
  tournamentId,
  tournament,
  onResolved,
}: AgeDisclosureModalProps) {
  const router = useRouter();
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function respond(consent: boolean) {
    setSubmitting(true);
    setError(undefined);
    try {
      const updated = await membersApi.setAgeDisclosure(tournamentId, consent);
      if (!consent) {
        router.replace("/dashboard");
        return;
      }
      onResolved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  const errorLine = error && (
    <p
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
        color: "var(--color-danger)",
      }}
    >
      {error}
    </p>
  );

  if (confirmingDecline) {
    return (
      <Modal
        title="Leave this tournament?"
        onClose={() => {}}
        closeOnOverlayClick={false}
        variant="danger"
        width={440}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.6,
            }}
          >
            This can&apos;t be undone. You&apos;ll be removed from this tournament right away.
          </p>
          {errorLine}
          <div style={{ display: "flex", gap: "10px" }}>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setError(undefined);
                setConfirmingDecline(false);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button variant="danger" fullWidth loading={submitting} onClick={() => respond(false)}>
              Decline and leave
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Age disclosure" onClose={() => {}} closeOnOverlayClick={false} width={440}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            color: "var(--color-text-secondary)",
            lineHeight: 1.6,
          }}
        >
          This tournament asks {thresholdCopy(tournament)}. It only sees the answer — your date of
          birth is never shared.
        </p>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            color: "var(--color-text-secondary)",
            lineHeight: 1.6,
          }}
        >
          You need to answer before continuing. Declining removes you from this tournament and
          deletes your responses to its forms. You&apos;ll need a new join link to come back.
        </p>
        {errorLine}
        <div style={{ display: "flex", gap: "10px" }}>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => setConfirmingDecline(true)}
            disabled={submitting}
          >
            Decline
          </Button>
          <Button fullWidth loading={submitting} onClick={() => respond(true)}>
            Allow
          </Button>
        </div>
      </div>
    </Modal>
  );
}
