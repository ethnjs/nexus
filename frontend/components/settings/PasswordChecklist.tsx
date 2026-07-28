import { PasswordChecks } from "@/lib/auth";
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons";

const ITEMS: { key: keyof PasswordChecks; label: string }[] = [
  { key: "length", label: "At least 8 characters" },
  { key: "upper",  label: "At least one uppercase letter" },
  { key: "lower",  label: "At least one lowercase letter" },
  { key: "number", label: "At least one number" },
  { key: "symbol", label: "At least one special symbol" },
  { key: "confirm", label: "Both passwords match" },
];

export function PasswordChecklist({ checks }: { checks: PasswordChecks }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {ITEMS.map(({ key, label }) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {checks[key]
            ? <IconCheckCircle style={{ color: "var(--color-success)" }} />
            : <IconXCircle style={{ color: "var(--color-danger)" }} />
          }
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px" }}>{label}</span>
        </div>
      ))}
    </div>
  );
}
