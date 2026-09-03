interface AvatarCircleUser {
  first_name?: string | null;
  last_name?: string | null;
}

export type AvatarCircleSize = "xs" | "sm" | "md" | "lg";

interface AvatarCircleProps {
  user: AvatarCircleUser;
  /** Named size (matches the app's xs/sm/md/lg height scale) or a raw pixel value. */
  size?: AvatarCircleSize | number;
}

// Matches Button/Input/Dropdown's height scale — box size in px, plus a font
// size tuned per box (not a flat multiplier, which reads too large at xs/sm).
const SIZE_MAP: Record<AvatarCircleSize, { box: number; font: number }> = {
  xs: { box: 26, font: 10 },
  sm: { box: 28, font: 11 },
  md: { box: 36, font: 13 },
  lg: { box: 48, font: 17 },
};

export function AvatarCircle({ user, size = 32 }: AvatarCircleProps) {
  // No email fallback: a person reference carries a name and roles only, and
  // an initial taken from an address isn't worth putting one back.
  const initials =
    (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`).toUpperCase() || "?";

  const { box, font } = typeof size === "number"
    ? { box: size, font: Math.max(11, Math.round(size * 0.34)) }
    : SIZE_MAP[size];

  return (
    <div
      style={{
        width: `${box}px`, height: `${box}px`, borderRadius: "50%",
        background: "var(--color-accent)", color: "var(--color-text-inverse)",
        fontFamily: "var(--font-sans)", fontSize: `${font}px`, fontWeight: 700,
        letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
