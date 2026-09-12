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
  // Text scales with the ring, keeping the proportions it was designed at
  // (38px and 13px on a 200px ring).
  const scale = size / 200;

  return (
    <ProgressRing completed={completed} total={total} size={size}>
      <span style={{ fontFamily: "Georgia, serif", fontSize: `${38 * scale}px`, color: "var(--color-text-primary)", lineHeight: 1 }}>
        {completed}/{total}
      </span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: `${13 * scale}px`, color: "var(--color-text-tertiary)" }}>
        tasks complete
      </span>
    </ProgressRing>
  );
}
