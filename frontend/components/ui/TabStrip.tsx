'use client'

import { useEffect, useRef } from 'react'

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
  const stripRef = useRef<HTMLDivElement>(null)

  // Bring the active tab into view by moving only the strip's own scrollLeft —
  // scrollIntoView would also scroll ancestors, including a folded CollapsibleHeader.
  useEffect(() => {
    const strip = stripRef.current
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!strip || !tab) return
    const left  = tab.offsetLeft // strip is position: relative, so this is measured from the strip
    const right = left + tab.offsetWidth
    if (left < strip.scrollLeft) strip.scrollTo({ left, behavior: 'smooth' })
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: right - strip.clientWidth, behavior: 'smooth' })
  }, [activeKey])

  return (
    // Scrolls sideways (scrollbar hidden) instead of wrapping or squashing labels when tabs outgrow the viewport.
    <div
      ref={stripRef}
      role="tablist"
      style={{
        display: "flex", gap: "4px", borderBottom: "1px solid var(--color-border)", marginBottom: "16px",
        overflowX: "auto", minWidth: 0, scrollbarWidth: "none", position: "relative",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={activeKey === tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            padding: "10px 4px", marginRight: "20px", border: "none", background: "transparent", cursor: "pointer",
            flexShrink: 0, whiteSpace: "nowrap",
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
