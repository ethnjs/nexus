"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError, authApi, type CodeChallenge } from "@/lib/api";

const CODE_LENGTH = 6;

interface CodeEntryProps {
  challenge: CodeChallenge;
  /** The address the code went to, shown in the prompt. */
  email: string;
  /** Checks the code; throw an ApiError to show its message. */
  onSubmit: (challengeToken: string, code: string) => Promise<void>;
  /** Called when the backend says the challenge takes no more codes, so it can't be reopened. */
  onClosed?: () => void;
  submitLabel?: string;
}

/** The emailed 6-digit code step, shared by sign-in, sign-up and step-up. */
export function CodeEntry({
  challenge: initialChallenge,
  email,
  onSubmit,
  onClosed,
  submitLabel = "Continue",
}: CodeEntryProps) {
  const [challenge, setChallenge] = useState(initialChallenge);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [closedByServer, setClosedByServer] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resendIn = Math.ceil((new Date(challenge.can_resend_at).getTime() - now) / 1000);
  const expiresIn = Math.ceil((new Date(challenge.expires_at).getTime() - now) / 60_000);
  const digits = code.replace(/\D/g, "");
  // Out of attempts or expired: no code or resend can work, so leave only the way back.
  const closed = closedByServer || expiresIn <= 0;

  function showError(err: unknown, fallback: string) {
    if (
      err instanceof ApiError &&
      (err.detail as { code?: unknown } | null)?.code === "code_closed"
    ) {
      setClosedByServer(true);
      onClosed?.();
    }
    setError(err instanceof ApiError ? err.message : fallback);
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    // Portal events bubble through the React tree, into a form the step-up modal opened over.
    e.stopPropagation();
    if (digits.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code.`);
      return;
    }
    setError(undefined);
    setNotice(undefined);
    setSubmitting(true);
    try {
      await onSubmit(challenge.challenge_token, digits);
    } catch (err: unknown) {
      showError(err, "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(undefined);
    setNotice(undefined);
    setResending(true);
    try {
      setChallenge(await authApi.resendCode(challenge.challenge_token));
      setCode("");
      setNotice("We sent a new code.");
    } catch (err: unknown) {
      showError(err, "Couldn't send a new code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          color: "var(--color-text-secondary)",
          margin: 0,
        }}
      >
        We emailed a {CODE_LENGTH}-digit code to <strong>{email}</strong>.{" "}
        {expiresIn > 0
          ? `It expires in ${expiresIn} minute${expiresIn === 1 ? "" : "s"}.`
          : "It has expired, so start again for a new one."}
      </p>

      <Input
        label="Code"
        font="mono"
        charset="numeric"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        placeholder="123456"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError(undefined);
        }}
        error={error}
        locked={closed}
        autoFocus
        fullWidth
      />

      <Button type="submit" loading={submitting} disabled={closed} fullWidth>
        {submitLabel}
      </Button>

      {!closed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          {notice && <span>{notice}</span>}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResend}
            loading={resending}
            disabled={resendIn > 0}
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </Button>
        </div>
      )}
    </form>
  );
}
