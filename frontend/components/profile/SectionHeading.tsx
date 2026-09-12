import { ReactNode } from "react";

// The h3 + content pairing every profile/member section repeats. Owning the
// header-to-content gap here (rather than leaning on ProfileCard's flex gap)
// keeps it identical whether a section is one of several blocks in a card or
// the card's only child.
export function SectionHeading({ title, action, children }: {
  title: string;
  /** One control belonging to the section as a whole, set against the title.
   *  Not a place for per-item controls — those live with their item. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "12px", marginBottom: "16px",
      }}>
        <h3 style={{
          fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
          color: "var(--color-text-primary)", margin: 0,
        }}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
