import styles from "./Spinner.module.css";

type Size = "sm" | "md" | "lg";

interface SpinnerProps {
  size?: Size;
  /** For use on a dark fill, such as a primary or danger button. */
  inverse?: boolean;
}

const sizeStyles: Record<Size, { width: string; height: string; borderWidth: string }> = {
  sm: { width: "14px", height: "14px", borderWidth: "2px" },
  md: { width: "20px", height: "20px", borderWidth: "2px" },
  lg: { width: "28px", height: "28px", borderWidth: "3px" },
};

export function Spinner({ size = "md", inverse = false }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={styles.spinner}
      style={{
        ...sizeStyles[size],
        borderColor: inverse
          ? "color-mix(in srgb, var(--color-text-inverse) 35%, transparent)"
          : "var(--color-border)",
        borderTopColor: inverse ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
      }}
    />
  );
}
