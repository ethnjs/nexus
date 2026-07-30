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
