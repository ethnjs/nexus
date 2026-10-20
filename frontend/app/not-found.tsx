"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  const router = useRouter();

  return (
    <main
      style={{
        // dvh so the centre is the visible viewport's, not under a mobile URL bar.
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        padding: "24px",
        textAlign: "center",
        background: "var(--color-bg)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "96px",
          lineHeight: 1,
          color: "var(--color-text-primary)",
        }}
      >
        404
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "20px",
          color: "var(--color-text-secondary)",
        }}
      >
        This page doesn&rsquo;t exist.
      </p>
      <Button size="md" onClick={() => router.push("/")}>
        Back to home
      </Button>
    </main>
  );
}
