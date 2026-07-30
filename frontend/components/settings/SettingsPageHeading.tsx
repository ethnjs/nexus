export function SettingsPageHeading({ title }: { title: string }) {
  return (
    <div style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-sm)",
      padding: "20px 28px",
      marginBottom: "24px",
    }}>
      <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "22px" }}>
        {title}
      </h1>
    </div>
  );
}
