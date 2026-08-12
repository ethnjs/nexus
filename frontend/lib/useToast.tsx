"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconCheckCircle, IconX, IconXCircle } from "@/components/ui/Icons";

export type ToastVariant = "success" | "error";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  /** Shows a toast, auto-dismissing after ~4s (or dismiss manually via the x). */
  show: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

const VARIANT_STYLES: Record<ToastVariant, { background: string; color: string; icon: ReactNode }> = {
  success: { background: "var(--color-text-primary)", color: "var(--color-text-inverse)", icon: <IconCheckCircle size={16} style={{ color: "var(--color-success)" }} /> },
  error:   { background: "var(--color-text-primary)", color: "var(--color-text-inverse)", icon: <IconXCircle size={16} style={{ color: "var(--color-danger)" }} /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  const nextId = useRef(0);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {mounted && createPortal(
        <div style={{
          position: "fixed", bottom: "20px", right: "20px", zIndex: 1000,
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          {toasts.map((t) => {
            const styles = VARIANT_STYLES[t.variant];
            return (
              <div
                key={t.id}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "10px 12px", minWidth: "220px", maxWidth: "360px",
                  background: styles.background, color: styles.color,
                  borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
                  fontFamily: "var(--font-sans)", fontSize: "13px",
                }}
              >
                {styles.icon}
                <span style={{ flex: 1 }}>{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "none", background: "transparent", padding: "2px",
                    color: "inherit", opacity: 0.7, cursor: "pointer", flexShrink: 0,
                  }}
                >
                  <IconX size={11} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
