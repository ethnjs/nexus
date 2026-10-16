"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import styles from "@/components/layout/CenteredCard.module.css";
import { Button } from "@/components/ui/Button";
import { IconCheckCircle, IconDiscord, IconXCircle } from "@/components/ui/Icons";
import { Spinner } from "@/components/ui/Spinner";
import { authApi } from "@/lib/api";
import { discordLinkErrorMessage } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";

// Where the bot's link buttons point. Signed out: sign in and come back. Signed in: straight on
// to Discord, whose callback returns here with ?linked= or ?error=.
export default function ConnectDiscordPage() {
  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.wordmark}>NEXUS</h1>
        <Suspense fallback={<Spinner size="lg" />}>
          <ConnectDiscordContent />
        </Suspense>
      </section>
    </div>
  );
}

function ConnectDiscordContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const linked = searchParams.get("linked") === "discord";
  const error = discordLinkErrorMessage(searchParams.get("error"));

  useEffect(() => {
    if (loading || linked || error) return;
    if (!user) {
      router.replace(`/sign-in?redirect=${encodeURIComponent("/connect/discord")}`);
      return;
    }
    window.location.assign(authApi.discordStartUrl());
  }, [loading, user, linked, error, router]);

  if (!linked && !error) return <Spinner size="lg" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
      <IconDiscord size={32} />
      <p
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          margin: 0,
          fontFamily: "var(--font-sans)",
          fontSize: "16px",
          color: "var(--color-text-primary)",
          textAlign: "center",
        }}
      >
        {linked ? (
          <>
            <IconCheckCircle style={{ color: "var(--color-success)" }} />
            Linked. Head back to Discord.
          </>
        ) : (
          <>
            <IconXCircle style={{ color: "var(--color-danger)" }} />
            {error}
          </>
        )}
      </p>
      {error && (
        <Button
          variant="secondary"
          onClick={() => window.location.assign(authApi.discordStartUrl())}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
