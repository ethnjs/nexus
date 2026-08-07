import { SetupChecklistItem } from "@/lib/api";
import { IconCheckCircle } from "@/components/ui/Icons";
import { Card } from "@/components/ui/Card";

export function ChecklistCard({
  item,
  onClick,
}: {
  item: SetupChecklistItem;
  onClick: (() => void) | null;
}) {
  const clickable = onClick !== null;
  const complete = item.status === "complete";

  return (
    <Card
      hoverable={clickable}
      onClick={clickable ? onClick : undefined}
      style={{
        padding: "16px 18px",
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.55,
        display: "flex", alignItems: "center", gap: "10px",
      }}
    >
      {complete ? (
        <IconCheckCircle size={18} style={{ color: "var(--color-success)", flexShrink: 0 }} />
      ) : (
        <div style={{
          width: "18px", height: "18px", borderRadius: "50%",
          border: "1.5px solid var(--color-border-strong)", flexShrink: 0,
        }} />
      )}
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>
          {item.label}
        </div>
        {!clickable && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            Coming soon
          </div>
        )}
      </div>
    </Card>
  );
}
