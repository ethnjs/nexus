"use client";

import { useCallback } from "react";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/useToast";

/**
 * Runs a write and toasts the outcome.
 *
 * Rethrows on failure rather than swallowing: a modal has to stay open, and
 * EditableText has to keep the field open with the message under it. The toast
 * is the confirmation channel, not a replacement for the control's own error
 * state — a failure that closes the thing you were editing is worse than one
 * you can retry in place.
 */
export function useActionToast() {
  const { show } = useToast();

  return useCallback(
    async function run<T>(successMessage: string, action: () => Promise<T>): Promise<T> {
      try {
        const result = await action();
        show(successMessage, "success");
        return result;
      } catch (err: unknown) {
        // The server's message where there is one — "Referenced by one or more
        // Users." says more than any wording this could invent.
        show(err instanceof ApiError ? err.message : "Something went wrong. Try again.", "error");
        throw err;
      }
    },
    [show],
  );
}
