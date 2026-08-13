export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Date + time, for a tooltip pinning down the exact moment behind a coarse
// label like formatDuration's "3d" or "Today".
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device"

  let os = "Unknown OS"
  if (/Windows/.test(ua)) os = "Windows"
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS"
  else if (/Android/.test(ua)) os = "Android"
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS"
  else if (/Linux/.test(ua)) os = "Linux"

  let browser = "Unknown browser"
  if (/Edg\//.test(ua)) browser = "Edge"
  else if (/OPR\//.test(ua)) browser = "Opera"
  else if (/Chrome\//.test(ua)) browser = "Chrome"
  else if (/Firefox\//.test(ua)) browser = "Firefox"
  else if (/Safari\//.test(ua)) browser = "Safari"

  return `${browser} on ${os}`
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Unknown"

  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 60) return "Just now"

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`

  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

// Coarser than formatRelativeTime — days/weeks/months/years once at least a
// day old, minutes/hours within the first day (no bare "Today" — "3h"/"12m"
// is more useful at a glance). For durations where "3mo" reads better than
// a precise-to-the-minute figure past the first day (account age,
// membership tenure).
export function formatDuration(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86400000)
  if (days < 1) {
    const hours = Math.floor(ms / 3600000)
    if (hours < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`
    return `${hours}h`
  }
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

// Counts down to a future point (e.g. an invite's expiry) — "2d 4h 13m 45s".
// Never collapses away smaller units once a larger one is showing.
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Expired"
  const totalSeconds = Math.floor(msRemaining / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (days > 0 || hours > 0) parts.push(`${hours}h`)
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}
