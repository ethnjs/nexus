"use client";

import type { EventStaffingNeedRead } from '@/lib/api'
import { ProgressRing } from '@/components/ui/ProgressRing'

/** One role's progress toward one track's need for it. Full role name and a
 *  plain `#/#`, not an abbreviation — the crowding that motivated an
 *  abbreviated line only happens once several tracks' roles share one line,
 *  and this always renders inside its own track's block. Same three-state
 *  colour as the chip warning border: success once filled, warning while
 *  short, muted at zero. */
export function StaffingNeedLine({ need, filled }: { need: EventStaffingNeedRead; filled: number }) {
  const color = filled >= need.count
    ? 'var(--color-success)'
    : filled > 0
      ? 'var(--color-warning)'
      : 'var(--color-border-strong)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <ProgressRing completed={filled} total={need.count} size={13} strokeWidth={16} color={color} />
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
        {need.role_label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        {filled}/{need.count}
      </span>
    </div>
  )
}
