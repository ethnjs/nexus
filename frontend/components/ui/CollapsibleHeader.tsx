'use client'

import { ReactNode, useEffect, useState } from 'react'

import { PageHeader } from '@/components/ui/PageHeader'
import { TabStrip } from '@/components/ui/TabStrip'
import { IconChevronDown } from '@/components/ui/Icons'
import { useSetPageCrumb, type PageCrumbTab } from '@/lib/usePageCrumb'
import { useHeaderCollapse } from '@/lib/useHeaderCollapse'
import styles from '@/components/ui/CollapsibleHeader.module.css'

interface CollapsibleHeaderProps {
  heading: string
  subheading?: string
  metadata?: ReactNode
  /** The page's own header action, if it has one. The fold control is not
   *  one of these — it lives in the gutter above the card, since it acts on
   *  the chrome rather than on the page. */
  action?: ReactNode
  /** Omit (or pass an empty list) for a page with no tabs: the header
   *  collapses to the title alone and the bar shows just that. */
  tabs?: PageCrumbTab[]
  activeKey?: string
  onChange?: (key: string) => void
  /** What the Topbar shows while folded, when that isn't this header — a
   *  settings page reads "Settings / General", with the other settings pages
   *  in the dropdown, though its header has no tabs. Keep it memoised. */
  crumb?: { title: string; tabs: PageCrumbTab[]; activeKey: string; onChange: (key: string) => void }
}

/**
 * A PageHeader (plus its tabs) that can fold itself into the Topbar.
 *
 * The header is the most expensive 120px on a dense page — a title you
 * already know and a row of tabs — so this hands it back and lends the
 * Topbar the two things worth keeping: what page you are on, and which tab.
 *
 * Adopting it on another page is one swap: render this instead of PageHeader,
 * and pass the tabs it was rendering itself. Nothing below has to know.
 */
export function CollapsibleHeader({
  heading, subheading, metadata, action, tabs, activeKey, onChange, crumb,
}: CollapsibleHeaderProps) {
  // The tournament's shared fold (see useHeaderCollapse), so every page
  // opens the way the last one was left. Local state only outside one.
  const shared = useHeaderCollapse()
  const [localCollapsed, setLocalCollapsed] = useState(false)
  const collapsed = shared ? shared.collapsed : localCollapsed
  const setCollapsed = shared ? shared.setCollapsed : setLocalCollapsed
  const { setCrumb, clearCrumb } = useSetPageCrumb()

  // Re-registered whenever the tab or the tab list moves, so the bar's menu
  // is never a frame behind the page. Cleared on expand *and* on unmount —
  // leaving the page must not leave its title in the bar.
  useEffect(() => {
    if (!collapsed) return
    setCrumb({
      ...(crumb ?? { title: heading, tabs, activeKey, onChange }),
      onExpand: () => setCollapsed(false),
    })
    return () => clearCrumb()
  }, [collapsed, setCollapsed, heading, tabs, activeKey, onChange, crumb, setCrumb, clearCrumb])

  return (
    <div className={styles.wrap}>
      {/* Only while the header is open. Folded away, the way back is the
          caret under the Topbar, centred on the crumb the header became —
          there is nothing left down here to hang a control off. */}
      {!collapsed && (
        <div className={styles.gutter}>
          <button
            type="button"
            className={styles.caret}
            onClick={() => setCollapsed(true)}
            title="Hide page header"
            aria-label="Hide page header"
            aria-expanded
          >
            <IconChevronDown size={13} />
          </button>
        </div>
      )}

      {/* grid-template-rows 1fr -> 0fr, which is the one way to transition to
          and from an auto height without measuring it. The child carries the
          overflow clip, since the row that is shrinking is this element's. */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: collapsed ? '0fr' : '1fr',
          opacity: collapsed ? 0 : 1,
          transition: 'grid-template-rows 220ms ease, opacity 160ms ease',
        }}
        // Nothing inside is reachable while it is folded away — not by tab,
        // not by a screen reader — and the Topbar carries what it said.
        aria-hidden={collapsed}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <PageHeader
            heading={heading}
            subheading={subheading}
            metadata={metadata}
            action={action}
          />
          {tabs && tabs.length > 0 && activeKey !== undefined && onChange && (
            <TabStrip tabs={tabs} activeKey={activeKey} onChange={onChange} />
          )}
        </div>
      </div>
    </div>
  )
}
