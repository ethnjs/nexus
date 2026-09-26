'use client'

import { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { SplitButton } from '@/components/ui/SplitButton'
import { IconX } from '@/components/ui/Icons'

interface ToolbarConfigButtonProps {
  /** Whether the thing this configures is currently off its default. */
  active: boolean
  /** The primary segment's icon. */
  icon: ReactNode
  /** Primary label — the tooltip when `iconOnly`. */
  label: string
  /** Tooltip on the right segment, e.g. "Clear filters" / "Reset cards". */
  actionLabel: string
  /** Opens the modal behind the button. */
  onOpen: () => void
  /** Puts the surface back to its default in one press. */
  onClear: () => void
  size?: 'sm' | 'md'
  /** Icon only, no label — for a panel header. */
  iconOnly?: boolean
}

/**
 * A toolbar control that opens a modal, with an undo folded into its right
 * edge that appears only while there is something to undo.
 *
 * Extracted from FilterButton when the display config wanted the same
 * behaviour: both are "open a modal that narrows or hides things, and give
 * me one press back to normal", and both lose the toolbar reflow that a
 * separate Clear button caused by appearing and disappearing beside them.
 *
 * `active` is the whole control: off, it is one plain secondary button; on,
 * it turns primary (black) so a list that is filtered or a card that is
 * cut down says so from the toolbar alone, and grows the segment that puts
 * it back.
 */
export function ToolbarConfigButton({
  active, icon, label, actionLabel, onOpen, onClear, size = 'md', iconOnly = false,
}: ToolbarConfigButtonProps) {
  if (!active) {
    return iconOnly ? (
      <Button
        type="button" variant="secondary" size={size} iconOnly
        title={label} aria-label={label} onClick={onOpen}
      >
        {icon}
      </Button>
    ) : (
      <Button
        type="button" variant="secondary" size={size}
        onClick={onOpen} style={{ flexShrink: 0 }}
      >
        {icon} {label}
      </Button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <SplitButton
        variant="primary"
        size={size}
        icon={icon}
        label={label}
        iconOnly={iconOnly}
        onClick={onOpen}
        action={{
          icon: <IconX size={size === 'sm' ? 12 : 14} />,
          label: actionLabel,
          onClick: onClear,
        }}
      />
    </span>
  )
}
