interface AvatarCircleUser {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}

interface AvatarCircleProps {
  user: AvatarCircleUser;
  size?: number;
}

export function AvatarCircle({ user, size = 32 }: AvatarCircleProps) {
  const initials =
    (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`).toUpperCase() ||
    user.email[0].toUpperCase();

  const fontSize = Math.max(11, Math.round(size * 0.34));

  return (
    <div
      style={{
        width: `${size}px`, height: `${size}px`, borderRadius: "50%",
        background: "var(--color-accent)", color: "var(--color-text-inverse)",
        fontFamily: "var(--font-sans)", fontSize: `${fontSize}px`, fontWeight: 700,
        letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {initials}
    </div>
  );
}