"use client";

import { useRouter } from "next/navigation";
import { GridWarp } from "@/components/home/GridWarp";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "./page.module.css";

const FEATURES = [
  { title: "Forms", body: "Build sign-up forms. Answers land in tables, not spreadsheets." },
  {
    title: "Events & shifts",
    body: "Set up tracks, events, buildings and shift times in one place.",
  },
  {
    title: "Assignments board",
    body: "Place volunteers on events and see where you’re short-staffed.",
  },
  {
    title: "Volunteer profiles",
    body: "Volunteers fill out one profile and reuse it across tournaments.",
  },
];

export default function HomePage() {
  const router = useRouter();

  return (
    <main>
      {/* dvh, not vh: on iOS 100vh is the viewport with the URL bar retracted,
          which pushes the bottom-anchored nav island below the fold. */}
      <section
        className="relative h-dvh flex flex-col items-center justify-center overflow-hidden"
        style={{ background: "var(--color-bg)" }}
      >
        <GridWarp />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 90% 80% at 50% 50%, var(--color-bg) 0%, var(--color-bg) 35%, transparent 85%)",
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-6 text-center px-6">
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              // 80px floor never let the wordmark scale below a 500px-wide
              // viewport; 56px lets it keep shrinking down to a small phone.
              fontSize: "clamp(56px, 16vw, 172px)",
              fontWeight: 400,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: "var(--color-text-primary)",
              animation: "fade-up 600ms ease 100ms forwards",
              opacity: 0,
            }}
          >
            NEXUS
          </h1>

          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "16px",
              fontWeight: 400,
              letterSpacing: "0.01em",
              color: "var(--color-text-secondary)",
              animation: "fade-up 600ms ease 300ms forwards",
              opacity: 0,
            }}
          >
            Tournament Logistics Dashboard for Science Olympiad
          </p>
        </div>

        {/* Floating island nav */}
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20"
          style={{ animation: "fade-in 600ms ease 500ms forwards", opacity: 0 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px",
              borderRadius: "999px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <Button
              variant="secondary"
              size="md"
              onClick={() => router.push("/sign-in")}
              style={{ borderRadius: "999px" }}
            >
              Sign in
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => router.push("/sign-up")}
              style={{ borderRadius: "999px" }}
            >
              Sign up
            </Button>
          </div>
        </div>
      </section>

      <section
        className="flex flex-col items-center px-4"
        style={{ background: "var(--color-bg)", paddingTop: "112px", paddingBottom: "120px" }}
      >
        <div style={{ maxWidth: "560px", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(28px, 5vw, 36px)",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            All your volunteers in one place.
          </h2>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "16px",
              lineHeight: 1.6,
              color: "var(--color-text-secondary)",
              margin: "16px 0 0",
            }}
          >
            NEXUS replaces the disconnected forms and spreadsheets Science Olympiad tournaments use
            to recruit, schedule and assign volunteers.
          </p>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 w-full"
          style={{ maxWidth: "720px", gap: "16px", marginTop: "64px" }}
        >
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              radius="lg"
              shadow={false}
              className={styles.featureCard}
              style={{ padding: "24px", transition: undefined }}
            >
              <h3
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "20px",
                  fontWeight: 400,
                  color: "var(--color-text-primary)",
                  margin: 0,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  color: "var(--color-text-secondary)",
                  margin: "8px 0 0",
                }}
              >
                {f.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <footer
        className="px-4"
        style={{ background: "var(--color-bg)", borderTop: "1px solid var(--color-border)" }}
      >
        <div
          className="flex flex-wrap items-center justify-between"
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            padding: "20px 0",
            gap: "8px 24px",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          <div className="flex flex-wrap items-baseline" style={{ gap: "4px 16px" }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "16px",
                letterSpacing: "-0.02em",
                color: "var(--color-text-primary)",
              }}
            >
              NEXUS
            </span>
            <span>
              <a
                href="https://socalscioly.org"
                target="_blank"
                rel="noopener noreferrer"
                className="link-subtle"
              >
                Southern California Science Olympiad
              </a>
              , a California 501(c)(3) non-profit
            </span>
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: "4px 20px" }}>
            <a href="mailto:support@nexus.socalscioly.org" className="link-subtle">
              support@nexus.socalscioly.org
            </a>
            <a
              href="https://discord.gg/2f9UWvEeMR"
              target="_blank"
              rel="noopener noreferrer"
              className="link-subtle"
            >
              Discord
            </a>
            <a
              href="https://docs.ethanshih.com/docs/nexus"
              target="_blank"
              rel="noopener noreferrer"
              className="link-subtle"
            >
              Docs
            </a>
            <span style={{ color: "var(--color-text-tertiary)" }}>© 2026</span>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}
