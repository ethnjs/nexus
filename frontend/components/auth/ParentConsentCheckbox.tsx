import { Checkbox } from "@/components/ui/Checkbox";

export function ParentConsentCheckbox({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
        <span>
          My parent or guardian has reviewed and agrees to the{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener"
            className="link-subtle"
            style={{ textDecoration: "underline" }}
          >
            Terms of Service
          </a>{" "}
          on my behalf.
        </span>
      </label>
      {error && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            margin: 0,
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
