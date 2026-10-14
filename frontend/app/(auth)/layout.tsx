"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import styles from "@/components/layout/CenteredCard.module.css";
import { IconArrowLeft } from "@/components/ui/Icons";

// Pages that show a "Back to home" link above the wordmark.
const BACK_TO_HOME_ROUTES = ["/sign-in", "/sign-up"];

export default function AuthLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        {BACK_TO_HOME_ROUTES.includes(pathname) && (
          <div className={styles.backRow}>
            <button
              onClick={() => router.push("/")}
              className="link-subtle"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontFamily: "var(--font-sans)",
              }}
            >
              <IconArrowLeft />
              Back to home
            </button>
          </div>
        )}
        <h1 className={styles.wordmark}>NEXUS</h1>
        {children}
      </section>
    </div>
  );
}
