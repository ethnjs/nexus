import { Checkbox } from "@/components/ui/Checkbox";

const linkStyle = { textDecoration: "underline" };

export function TermsAgreement({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
        color: "var(--color-text-secondary)",
      }}
    >
      <Checkbox checked={checked} onChange={onChange} />
      {/* New tab, so following a link doesn't lose what's typed on the page. */}
      <span>
        I have read and agree to the{" "}
        <a href="/terms" target="_blank" rel="noopener" className="link-subtle" style={linkStyle}>
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noopener" className="link-subtle" style={linkStyle}>
          Privacy Policy
        </a>
        .
      </span>
    </label>
  );
}
