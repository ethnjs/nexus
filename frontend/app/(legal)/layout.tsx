import Link from "next/link";
import type { ReactNode } from "react";
import { IconArrowLeft } from "@/components/ui/Icons";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px 96px" }}>
      <Link
        href="/"
        className="link-subtle"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "32px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <IconArrowLeft />
        Back to home
      </Link>
      {children}
    </main>
  );
}
