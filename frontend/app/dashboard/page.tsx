"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { tournamentsApi, eventsApi, membershipsApi, Tournament, User, authApi, ApiError } from "@/lib/api"
import { NewTournamentModal } from "@/components/ui/NewTournamentModal"
import { Topbar } from "@/components/layout/Topbar"
import { Banner, BannerProps } from "@/components/ui/Banner"
import { Button } from "@/components/ui/Button"
import { IconPlus, IconCalendar, IconLocation } from "@/components/ui/Icons"
import { useAuth } from "@/lib/useAuth"
import { Tooltip, TooltipStatus } from "@/components/ui/Tooltip"



interface BannerRule extends Omit<BannerProps, 'onDismiss'> {
  id: number
  condition: (user: User) => boolean
  snoozeDays: number
}


// ─── Tournament Card ──────────────────────────────────────────────────────────

interface CardCounts { events: number | null; volunteers: number | null }

function TournamentCard({ tournament, counts, onClick }: { tournament: Tournament; counts: CardCounts; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

  const dateRange = tournament.start_date
    ? tournament.end_date && tournament.end_date !== tournament.start_date
      ? `${fmt(tournament.start_date)} – ${fmt(tournament.end_date)}`
      : fmt(tournament.start_date)
    : null

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--color-surface)",
        border: `1px solid ${hovered ? "var(--color-border-strong)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-lg)", padding: "22px 24px",
        textAlign: "left", cursor: "pointer", width: "100%",
        transition: "border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)",
        boxShadow: hovered ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: hovered ? "translateY(-1px)" : "none",
        display: "flex", flexDirection: "column", gap: "14px",
      }}
    >
      <h3 style={{ fontFamily: "Georgia, serif", fontSize: "19px", fontWeight: 400, color: "var(--color-text-primary)", lineHeight: 1.25 }}>
        {tournament.name}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {tournament.location && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
            <IconLocation />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px" }}>{tournament.location}</span>
          </div>
        )}
        {dateRange && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--color-text-tertiary)" }}>
            <IconCalendar />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{dateRange}</span>
          </div>
        )}
      </div>
      <div style={{ paddingTop: "14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: "20px" }}>
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {counts.events === null ? "—" : counts.events}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Events</div>
        </div>
        <div style={{ width: "1px", background: "var(--color-border)" }} />
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {counts.volunteers === null ? "—" : counts.volunteers}
          </div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Volunteers</div>
        </div>
      </div>
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────



export default function DashboardPage() {
  const router = useRouter()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [counts, setCounts]           = useState<Record<number, CardCounts>>({})
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
      condition: user => user.missing_profile_fields.length > 0, snoozeDays: 3,
      action: <Button
        variant="secondary"
        size="sm"
        onClick={() => router.push('/dashboard')} // temp for now, will push to profile later
      >Complete Profile</Button>
    }
  ]

  const activeBanners = bannerRules.filter(e => {
    if (!user) return false
    return e.condition(user) && (new Date(Date.now()).toISOString() >= (dismissedBanners[e.id] ?? ''))
  })

  

  useEffect(() => {
    tournamentsApi.list().then((data) => {
      setTournaments(data)
      data.forEach((t) => {
        Promise.all([
          eventsApi.listByTournament(t.id).then((e) => e.length).catch(() => 0),
          membershipsApi.listByTournament(t.id).then((m) => m.length).catch(() => 0),
        ]).then(([events, volunteers]) => {
          setCounts((prev) => ({ ...prev, [t.id]: { events, volunteers } }))
        })
      })
    }).catch(() => {}).finally(() => setLoading(l => ({...l, "page": false})))
  }, [])

  function handleCreated(t: Tournament) {
    setTournaments((prev) => [...prev, t])
    setCounts((prev) => ({ ...prev, [t.id]: { events: 0, volunteers: 0 } }))
    setShowModal(false)
    router.push(`/dashboard/${t.id}/overview`)
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

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
            <div>
              <h1 style={{ fontSize: "28px", marginBottom: "4px" }}>Tournaments</h1>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)" }}>
                {loading["page"] ? "" : tournaments.length === 0 ? "No tournaments yet" : `${tournaments.length} tournament${tournaments.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <Button variant="primary" size="md" onClick={() => setShowModal(true)}>
              <IconPlus />
              Add Tournament
            </Button>
          </div>

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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
              {tournaments.map((t) => (
                <TournamentCard
                  key={t.id} tournament={t}
                  counts={counts[t.id] ?? { events: null, volunteers: null }}
                  onClick={() => router.push(`/dashboard/${t.id}/overview`)}
                />
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