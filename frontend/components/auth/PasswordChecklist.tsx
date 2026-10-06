import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PasswordChecks } from "@/lib/auth";
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons";

// onlyWhenFailing: a restriction rather than a goal, so it appears only once broken
const ITEMS: { key: keyof PasswordChecks; label: string; onlyWhenFailing?: boolean }[] = [
  { key: "length", label: `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters` },
  { key: "upper",  label: "At least one uppercase letter" },
  { key: "lower",  label: "At least one lowercase letter" },
  { key: "number", label: "At least one number" },
  { key: "symbol", label: "At least one special symbol" },
  { key: "valid",  label: "Remove spaces and non-English characters", onlyWhenFailing: true },
  { key: "confirm", label: "Both passwords match" },
];

export function PasswordChecklist({ checks }: { checks: PasswordChecks }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {ITEMS.filter(({ key, onlyWhenFailing }) => !onlyWhenFailing || !checks[key]).map(({ key, label }) => (
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
