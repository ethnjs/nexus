'use client'

import { RadioOption } from "@/components/ui/RadioOption"

export interface RadioGroupOption {
  value:       string
  label:       string
  description?: string
}

interface RadioGroupProps {
  name:       string
  value:      string | null
  onChange:   (value: string) => void
  options:    RadioGroupOption[]
  mono?:      boolean
  showCircle?: boolean
  solid?:     boolean
  direction?: 'row' | 'column'
  gap?:       string
  disabled?:  boolean
}

export function RadioGroup({
  name,
  value,
  onChange,
  options,
  mono,
  showCircle,
  solid,
  direction = 'row',
  gap = '8px',
  disabled = false,
}: RadioGroupProps) {
  return (
    <div style={{ display: 'flex', flexDirection: direction, gap }}>
      {options.map(opt => (
        <RadioOption
          key={opt.value}
          name={name}
          value={opt.value}
          checked={value === opt.value}
          onChange={onChange}
          label={opt.label}
          description={opt.description}
          mono={mono}
          showCircle={showCircle}
          solid={solid}
          disabled={disabled}
        />
      ))}
    </div>
  )
}