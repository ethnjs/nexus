"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChipInput, type ChipStatus } from "@/components/ui/ChipInput";
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons";
import { ApiError, type InviteEmailResponse, invitesApi, membersApi } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteEmailFormProps {
  tournamentId: number;
  inviteId: number;
  onClose: () => void;
  /** Label of the button that closes without sending, e.g. "Skip" after creating an invite. */
  cancelLabel?: string;
  onSent?: (response: InviteEmailResponse) => void;
}

/** Emails an invite's join link to a list of addresses, then shows which the provider accepted. */
export function InviteEmailForm({
  tournamentId,
  inviteId,
  onClose,
  cancelLabel = "Cancel",
  onSent,
}: InviteEmailFormProps) {
  const [memberEmails, setMemberEmails] = useState<Set<string> | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailsError, setEmailsError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<InviteEmailResponse | null>(null);

  useEffect(() => {
    // Without manage_members this 403s, and the "already a member" warning is skipped.
    membersApi
      .list(tournamentId, { fields: ["contact"] })
      .then((members) => setMemberEmails(new Set(members.map((m) => m.user.email.toLowerCase()))))
      .catch(() => setMemberEmails(null));
  }, [tournamentId]);

  function getChipStatus(chip: string): ChipStatus {
    if (!EMAIL_PATTERN.test(chip)) return "error";
    if (memberEmails?.has(chip.toLowerCase())) return "warning";
    return "default";
  }

  const hasInvalid = emails.some((e) => !EMAIL_PATTERN.test(e));
  const hasWarning = emails.some(
    (e) => EMAIL_PATTERN.test(e) && memberEmails?.has(e.toLowerCase()),
  );

  async function handleSend() {
    setEmailsError(undefined);
    setError(undefined);

    if (emails.length === 0) {
      setEmailsError("Enter at least one email address");
      return;
    }
    if (hasInvalid) {
      setEmailsError("Fix the invalid addresses before sending");
      return;
    }

    const toSend = emails.filter((e) => !memberEmails?.has(e.toLowerCase()));
    if (toSend.length === 0) {
      setEmailsError("Everyone entered is already a member of this tournament");
      return;
    }

    setSending(true);
    try {
      const response = await invitesApi.sendEmails(tournamentId, inviteId, toSend);
      setResult(response);
      onSent?.(response);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (result) {
    const allSucceeded = result.failed.length === 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            padding: "4px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: allSucceeded
                ? "var(--color-success-subtle)"
                : "var(--color-warning-subtle)",
              color: allSucceeded ? "var(--color-success)" : "var(--color-warning)",
              marginBottom: "12px",
            }}
          >
            {allSucceeded ? <IconCheckCircle size={26} /> : <IconXCircle size={26} />}
          </div>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "19px",
              color: "var(--color-text-primary)",
            }}
          >
            {result.sent.length} invite{result.sent.length === 1 ? "" : "s"} sent
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              marginTop: "4px",
            }}
          >
            {allSucceeded
              ? "Accepted for delivery. A bad address can still bounce later."
              : `${result.failed.length} couldn't be sent`}
          </p>
        </div>

        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}
        >
          {[
            ...result.sent.map((email) => ({ email, ok: true })),
            ...result.failed.map((email) => ({ email, ok: false })),
          ].map(({ email, ok }, i, arr) => (
            <div
              key={email}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 12px",
                borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--color-border)",
              }}
            >
              {ok ? (
                <IconCheckCircle size={15} style={{ color: "var(--color-success)" }} />
              ) : (
                <IconXCircle size={15} style={{ color: "var(--color-danger)" }} />
              )}
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: ok ? "var(--color-text-primary)" : "var(--color-danger)",
                }}
              >
                {email}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <ChipInput
        label="Emails"
        placeholder="Type an email and press Enter"
        value={emails}
        onChange={(next) => {
          setEmails(next);
          setEmailsError(undefined);
        }}
        getChipStatus={getChipStatus}
        error={emailsError}
        fullWidth
      />
      {hasWarning && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-warning)",
          }}
        >
          Highlighted emails already belong to members of this tournament — they won&rsquo;t be sent
          an invite.
        </p>
      )}

      {error && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="primary" loading={sending} onClick={handleSend}>
          Send invites
        </Button>
      </div>
    </div>
  );
}
