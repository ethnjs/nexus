'use client'

interface TabStripTab<T extends string> {
  key:   T
  label: string
}

interface TabStripProps<T extends string> {
  tabs:      TabStripTab<T>[]
  activeKey: T
  onChange:  (key: T) => void
}

export function TabStrip<T extends string>({ tabs, activeKey, onChange }: TabStripProps<T>) {
  return (
    <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--color-border)", marginBottom: "16px" }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          style={{
            padding: "10px 4px", marginRight: "20px", border: "none", background: "transparent", cursor: "pointer",
            borderBottom: activeKey === tab.key ? "2px solid var(--color-accent)" : "2px solid transparent",
            fontFamily: "var(--font-sans)", fontSize: "13px",
            fontWeight: activeKey === tab.key ? 600 : 500,
            color: activeKey === tab.key ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
