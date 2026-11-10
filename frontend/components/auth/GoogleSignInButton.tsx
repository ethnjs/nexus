import { IconGoogle } from "@/components/ui/Icons";

// Google's sign-in branding: multicolor mark, "Continue with Google", neutral fill.
// An anchor, not a button — the backend responds with a redirect to Google.

export function GoogleSignInButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        width: "100%",
        boxSizing: "border-box",
        padding: "10px 16px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: "14px",
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      <IconGoogle size={18} />
      Continue with Google
    </a>
  );
}
