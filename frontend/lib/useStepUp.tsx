"use client";

import { useRef, useState } from "react";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { Modal } from "@/components/ui/Modal";
import { ApiError, authApi, type CodeChallenge } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

export function isStepUpRequired(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.detail as { code?: unknown } | null)?.code === "step_up_required"
  );
}

interface PendingStepUp {
  challenge: CodeChallenge;
  resolve: () => void;
  cancel: () => void;
}

/**
 * Runs a sensitive action, and when the backend answers `step_up_required`, emails a code,
 * asks for it in a modal, and retries. Render `stepUpModal` once in the calling component.
 * Closing the modal rejects with the original 403, whose message says a code is needed.
 */
export function useStepUp() {
  const { user } = useAuth();
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const lastChallenge = useRef<CodeChallenge | null>(null);

  async function startOrReopen(): Promise<CodeChallenge> {
    try {
      lastChallenge.current = await authApi.startStepUp();
      return lastChallenge.current;
    } catch (err: unknown) {
      // A 429 means the code sent under a minute ago is still open, so reopen it rather than
      // making someone who closed the prompt wait. A used-up or expired one gets no 429.
      const last = lastChallenge.current;
      const open = last !== null && new Date(last.expires_at).getTime() > Date.now();
      if (err instanceof ApiError && err.status === 429 && open) return last;
      throw err;
    }
  }

  async function withStepUp<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err: unknown) {
      if (!isStepUpRequired(err)) throw err;
      const challenge = await startOrReopen();
      await new Promise<void>((resolve, reject) =>
        setPending({ challenge, resolve, cancel: () => reject(err) }),
      );
      return action();
    }
  }

  const stepUpModal = pending && (
    <Modal
      title="Confirm it's you"
      onClose={() => {
        pending.cancel();
        setPending(null);
      }}
    >
      <CodeEntry
        challenge={pending.challenge}
        email={user?.email ?? "your email address"}
        submitLabel="Confirm"
        onSubmit={async (challengeToken, code) => {
          await authApi.verifyStepUp(challengeToken, code);
          setPending(null);
          pending.resolve();
        }}
      />
    </Modal>
  );

  return { withStepUp, stepUpModal };
}
