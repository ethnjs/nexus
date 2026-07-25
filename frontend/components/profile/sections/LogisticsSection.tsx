import { Badge } from "@/components/ui/Badge";

interface LogisticsUser {
  shirt_size: "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  dietary_restriction: string | null;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color: "var(--color-text-tertiary)", marginBottom: "3px",
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
        color: value !== null ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
      }}>
        {value !== null ? value : "No info yet"}
      </div>
    </div>
  );
}

export function LogisticsSection({ user }: { user: LogisticsUser }) {
  return (
    <div>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "16px",
      }}>
        Logistics
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div>
          <div style={{
            fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.06em",
            color: "var(--color-text-tertiary)", marginBottom: "5px",
          }}>
            Shirt Size
          </div>
          {user.shirt_size !== null ? (
            <Badge variant="default">{user.shirt_size}</Badge>
          ) : (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-tertiary)" }}>
              No info yet
            </span>
          )}
        </div>
        <Field label="Dietary Restriction" value={user.dietary_restriction} />
      </div>
    </div>
  );
}