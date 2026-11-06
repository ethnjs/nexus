import type { ReactNode } from "react";

/** The title under the auth card's wordmark, with an optional line saying what the page is for. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div style={{ width: "100%", textAlign: "center", marginBottom: "28px" }}>
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "26px",
          fontWeight: 400,
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            color: "var(--color-text-secondary)",
            margin: "6px 0 0",
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
