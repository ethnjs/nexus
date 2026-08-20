'use client'

import { Dropdown } from '@/components/ui/Dropdown'

export interface RankedListOption {
  value: string
  label: string
}

interface RankedListProps {
  options: RankedListOption[]
  ranks: number
  /** rank ("1".."ranks") -> option value. An option with no entry is unranked. */
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
  locked?: boolean
}

// Assign each option a rank via a small per-row Dropdown (1..ranks) — no
// equivalent existed for "pick-one-of-a-few, in order" the way ButtonGroup
// covers single/multi-select, so this is a new generic primitive rather
// than something forms-specific.
export function RankedList({ options, ranks, value, onChange, locked = false }: RankedListProps) {
  const rankOptions = Array.from({ length: ranks }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))

  function rankFor(optionValue: string): string {
    const entry = Object.entries(value).find(([, v]) => v === optionValue)
    return entry?.[0] ?? ''
  }

  function setRank(optionValue: string, newRank: string) {
    const next = { ...value }
    for (const [rank, v] of Object.entries(next)) {
      if (v === optionValue || rank === newRank) delete next[rank]
    }
    next[newRank] = optionValue
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {options.map((opt) => (
        <div key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Dropdown
            value={rankFor(opt.value)}
            onChange={(newRank) => setRank(opt.value, newRank)}
            options={rankOptions}
            placeholder="—"
            locked={locked}
            size="sm"
            width={56}
          />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {opt.label}
          </span>
        </div>
      ))}
    </div>
  )
}
