"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { tournamentsApi, Tournament, TournamentSummary, UserMeSlim, authApi, ApiError } from "@/lib/api"
import { NewTournamentModal } from "@/components/tournament/NewTournamentModal"
import { TournamentCard } from "@/components/tournament/TournamentCard"
import { Topbar } from "@/components/layout/Topbar"
import { PageHeader } from "@/components/ui/PageHeader"
import { Banner, BannerProps } from "@/components/ui/Banner"
import { Button } from "@/components/ui/Button"
import { IconPlus } from "@/components/ui/Icons"
import { useAuth } from "@/lib/useAuth"
import { Tooltip, TooltipStatus } from "@/components/ui/Tooltip"



interface BannerRule extends Omit<BannerProps, 'onDismiss'> {
  id: number
  condition: (user: UserMeSlim) => boolean
  snoozeDays: number
}


// ─── Page ─────────────────────────────────────────────────────────────────────



export default function DashboardPage() {
  const router = useRouter()
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([])
  const [loading, setLoading]         = useState<Record<string, boolean>>({"page": true})
  const [showModal, setShowModal]     = useState(false)

  const [dismissedBanners, setDismissedBanners] = useState<Record<number, string>>(() => {
    const dismissed = typeof window !== "undefined" ? localStorage.getItem("dismissedBanners") : "{}"
    if (!dismissed) return {}
    try {
      return JSON.parse(dismissed)
    } catch {
      return {}
    }
  })

  const [tooltipStatus, setTooltipStatus] = useState<Record<string, TooltipStatus>>({"resendEmail": 'idle'})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const user = useAuth().user

  const resendEmailTooltipMessages: Partial<Record<TooltipStatus, string | undefined>> = {
    'success': "Email sent successfully. Please check your inbox.",
    'error': errors["resendEmail"] ?? undefined
  }

  const bannerRules: BannerRule[] = [
    {id: 1, variant: "warning", message: "Please verify your email address", 
      condition: user => !user.email_verified, snoozeDays: 1,
      action: <Tooltip
        status={tooltipStatus["resendEmail"]}
        message={resendEmailTooltipMessages}
      ><Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setLoading(l => ({...l, "verify-email": true}))
            authApi.sendEmailVerification().then(() => setTooltipStatus(s => ({...s, "resendEmail": 'success'}))).catch(err => {
              const message = err instanceof ApiError ? err.message : "Something went wrong"
              setTooltipStatus(s => ({...s, "resendEmail": 'error'}))
              setErrors({"resendEmail": message})
            }).finally(() => setLoading(l => ({...l, "verify-email": false})))
          }}
          loading={loading["verify-email"]}
        >Resend Email</Button>
      </Tooltip>
    },
    {id: 2, variant: "warning", message: "Your profile is incomplete",
      condition: user => !user.is_profile_complete, snoozeDays: 3,
      action: <Button
        variant="secondary"
        size="sm"
        onClick={() => user && router.push(`/profile/${user.id}/edit`)}
      >Complete Profile</Button>
    }
  ]

  const activeBanners = bannerRules.filter(e => {
    if (!user) return false
    return e.condition(user) && (new Date(Date.now()).toISOString() >= (dismissedBanners[e.id] ?? ''))
  })

  

  useEffect(() => {
    tournamentsApi.list()
      .then(setTournaments)
      .catch(() => {})
      .finally(() => setLoading(l => ({...l, "page": false})))
  }, [])

  function handleCreated(t: Tournament) {
    setTournaments((prev) => [...prev, { ...t, event_count: 0, volunteer_count: 0 }])
    setShowModal(false)
    router.push(`/dashboard/tournaments/${t.id}/overview`)
  }

  function dismissBanner(id: number, snoozeDays: number) {
    const dismissed = {...dismissedBanners, [id]: new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000).toISOString()}
    setDismissedBanners(dismissed)
    localStorage.setItem('dismissedBanners', JSON.stringify(dismissed))
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />

      <main style={{ flex: 1, overflowY: "auto", padding: "28px" }}>
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          
          {activeBanners.length > 0 && activeBanners.map(({ id, variant, message, action, snoozeDays }) => {
            return (
              <div key={id} style={{ marginBottom: '15px' }}>
                <Banner
                  variant={variant}
                  message={message}
                  action={action}
                  onDismiss={() => dismissBanner(id, snoozeDays)}
                />
              </div>
            )
          })}

          <PageHeader
            heading="Tournaments"
            subheading={loading["page"] ? "" : tournaments.length === 0 ? "No tournaments yet" : `${tournaments.length} tournament${tournaments.length !== 1 ? "s" : ""}`}
            action={
              <Button variant="primary" size="md" onClick={() => setShowModal(true)}>
                <IconPlus />
                Add Tournament
              </Button>
            }
          />

          {loading["page"] ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ height: "180px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", opacity: 0.5 }} />
              ))}
            </div>
          ) : tournaments.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "320px", gap: "12px", textAlign: "center" }}>
              <p style={{ fontFamily: "Georgia, serif", fontSize: "24px", color: "var(--color-text-primary)" }}>No tournaments yet</p>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", maxWidth: "280px" }}>Create your first tournament to get started.</p>
              <Button variant="secondary" size="md" onClick={() => setShowModal(true)} style={{ marginTop: "8px" }}>
                <IconPlus />
                Create tournament
              </Button>
            </div>
          ) : (
            // Masonry via CSS columns, not grid: a card's height is its
            // content, and a multi-site tournament listing a row per track is
            // legitimately taller than a single-day one. A grid would either
            // stretch every card to the tallest or leave a ragged bottom row.
            // (grid-template-rows: masonry isn't shipping in Chrome yet.)
            <div style={{ columnWidth: "280px", columnGap: "16px" }}>
              {tournaments.map((t) => (
                <div key={t.id} style={{ breakInside: "avoid", marginBottom: "16px" }}>
                  <TournamentCard
                    tournament={t}
                    onClick={() => router.push(`/dashboard/tournaments/${t.id}/overview`)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showModal && (
        <NewTournamentModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}
    </div>
  )
}