import { Google_Sans } from "next/font/google";
import { IconGoogle } from "@/components/ui/Icons";
import styles from "./GoogleSignInButton.module.css";

const googleSans = Google_Sans({ subsets: ["latin"], weight: "500" });

// Google's light-theme button from its Sign in with Google branding guidelines; its size,
// colors, font, and spacing are Google's, not the app's. An anchor, since the backend
// answers with a redirect to Google.
export function GoogleSignInButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      className={styles.button}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        width: "100%",
        height: "40px",
        boxSizing: "border-box",
        padding: "0 12px",
        borderRadius: "4px",
        border: "1px solid var(--color-google-button-border)",
        background: "var(--color-google-button-fill)",
        color: "var(--color-google-button-text)",
        fontFamily: googleSans.style.fontFamily,
        fontSize: "14px",
        fontWeight: 500,
        lineHeight: "20px",
        letterSpacing: "0.25px",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      <IconGoogle size={20} />
      Continue with Google
    </a>
  );
}
