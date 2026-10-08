'use client'

import { Button } from '@/components/ui/Button'
import { IconArrowDown } from '@/components/ui/Icons'
import type { SortDirection } from '@/lib/sorting'

interface SortableHeaderProps {
  label: string
  /** This column's place in the sort chain, or null when it isn't in it. */
  rule: { direction: SortDirection; position: number } | null
  /** Show the position number — only worth it once more than one rule is on. */
  showPosition: boolean
  align?: 'start' | 'center'
  onClick: () => void
}

/**
 * A table header cell that sorts its column on click (see cycleSortRule).
 * A Button for keyboard reach, stripped to inherit the header's own type so it
 * reads as a label, not a control.
 */
export function SortableHeader({ label, rule, showPosition, align = 'center', onClick }: SortableHeaderProps) {
  const title = rule
    ? `Sorted ${rule.direction === 'asc' ? 'ascending' : 'descending'} — click to ${rule.direction === 'asc' ? 'reverse' : 'remove'}`
    : `Sort by ${label.toLowerCase()}`
  return (
    <Button
      type="button" variant="ghost" interactive={false}
      onClick={onClick}
      title={title}
      style={{
        height: 'auto', padding: 0, border: 'none', minWidth: 0, gap: '4px',
        justifyContent: align === 'start' ? 'flex-start' : 'center',
        fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
        letterSpacing: 'inherit', textTransform: 'inherit',
        color: rule ? 'var(--color-text-primary)' : 'inherit',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>{label}</span>
      {rule && (
        <>
          <IconArrowDown
            size={11}
            style={{ flexShrink: 0, transform: rule.direction === 'asc' ? 'rotate(180deg)' : undefined }}
          />
          {/* Same face and size as the label, so both sit on one line box. */}
          {showPosition && <span style={{ lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{rule.position}</span>}
        </>
      )}
    </Button>
  )
}
