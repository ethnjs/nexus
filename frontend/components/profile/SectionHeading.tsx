import { ReactNode } from "react";

// The h3 + content pairing every profile/member section repeats. Owning the
// header-to-content gap here (rather than leaning on ProfileCard's flex gap)
// keeps it identical whether a section is one of several blocks in a card or
// the card's only child.
export function SectionHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "16px",
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}
