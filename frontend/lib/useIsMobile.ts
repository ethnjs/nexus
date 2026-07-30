import { useEffect, useState } from "react"

const MOBILE_BREAKPOINT_PX = 640

// Tracks a single (max-width: 640px) media query. Layout code reads this to
// switch between desktop and mobile arrangements without a CSS file.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`)
    setIsMobile(mql.matches)

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  return isMobile
}
