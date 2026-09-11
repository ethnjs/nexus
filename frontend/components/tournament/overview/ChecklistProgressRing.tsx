import { ProgressRing } from "@/components/ui/ProgressRing";

export function ChecklistProgressRing({
  completed,
  total,
  size = 200,
}: {
  completed: number;
  total: number;
  size?: number;
}) {
  return (
    <ProgressRing completed={completed} total={total} size={size}>
      <span style={{ fontFamily: "Georgia, serif", fontSize: "38px", color: "var(--color-text-primary)", lineHeight: 1 }}>
        {completed}/{total}
      </span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
        tasks complete
      </span>
    </ProgressRing>
  );
}
