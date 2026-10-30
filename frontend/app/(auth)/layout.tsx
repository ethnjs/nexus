"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { GridWarp } from "@/components/home/GridWarp";
import styles from "@/components/layout/CenteredCard.module.css";
import { IconArrowLeft } from "@/components/ui/Icons";
import { safeRedirectPath } from "@/lib/auth";

// The two ways in, each offering the other under the card. Only they get
// "Back to home"; the rest are reached from an email link.
const SWITCHES: Record<string, { prompt: string; label: string; href: string }> = {
  "/sign-in": { prompt: "Don’t have an account?", label: "Sign up", href: "/sign-up" },
  "/sign-up": { prompt: "Already have an account?", label: "Sign in", href: "/sign-in" },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isEntry = pathname in SWITCHES;

  return (
    <div className={styles.page}>
      <div className={styles.authGrid} aria-hidden>
        {/* --color-border: lighter than the home page's lines, which have only a
            wordmark to compete with rather than a form. */}
        <GridWarp lineColor={0xe2e2de} />
      </div>
      {isEntry && (
        <button
          type="button"
          onClick={() => router.push("/")}
          className={`link-subtle ${styles.backLink} ${styles.cloud}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
          }}
        >
          <IconArrowLeft />
          Back to home
        </button>
      )}
      <div className={styles.authStack}>
        <section className={`${styles.card} ${styles.authCard}`}>
          <h1 className={`${styles.wordmark} ${styles.wordmarkCompact}`}>NEXUS</h1>
          {children}
        </section>
        {isEntry && (
          <Suspense fallback={null}>
            <AuthSwitch pathname={pathname} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/** "Don't have an account? Sign up", carrying the redirect across so the
 *  other page still lands where the visitor was headed. */
function AuthSwitch({ pathname }: { pathname: string }) {
  const router = useRouter();
  const redirect = safeRedirectPath(useSearchParams().get("redirect"));
  const { prompt, label, href } = SWITCHES[pathname];

  return (
    <p
      className={styles.cloud}
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
        color: "var(--color-text-secondary)",
        margin: 0,
      }}
    >
      {prompt}{" "}
      <button
        type="button"
        onClick={() =>
          router.push(redirect ? `${href}?redirect=${encodeURIComponent(redirect)}` : href)
        }
        className="link-subtle"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        {label}
      </button>
    </p>
  );
}
