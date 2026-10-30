"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AddTournamentModal } from "@/components/tournament/AddTournamentModal";
import { TournamentCard } from "@/components/tournament/TournamentCard";
import {
  TOURNAMENTS_FILTER_KEYS,
  TournamentsFilterModal,
  type TournamentsFilterState,
  tournamentPassesFilters,
} from "@/components/tournament/TournamentsFilterModal";
import { Banner, type BannerProps } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterButton } from "@/components/ui/FilterButton";
import { emptyFilterState, isFilterActive } from "@/components/ui/FilterModal";
import { IconPlus, IconSearch, IconTrophy } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { MasonryGrid } from "@/components/ui/MasonryGrid";
import { PageHeader } from "@/components/ui/PageHeader";
import { SortButton } from "@/components/ui/SortButton";
import { SortModal } from "@/components/ui/SortModal";
import { Tooltip, type TooltipStatus } from "@/components/ui/Tooltip";
import {
  ApiError,
  authApi,
  type Tournament,
  type TournamentSummary,
  tournamentsApi,
  type UserMeSlim,
} from "@/lib/api";
import { type SortRule, sameSortRules, sortRows } from "@/lib/sorting";
import {
  DEFAULT_TOURNAMENT_SORT,
  TOURNAMENT_SORT_OPTIONS,
  TOURNAMENT_SORT_TIEBREAK,
  type TournamentSortField,
  tournamentSortTiebreak,
  tournamentSortValue,
} from "@/lib/tournamentSort";
import { useAuth } from "@/lib/useAuth";

interface BannerRule extends Omit<BannerProps, "onDismiss"> {
  id: number;
  condition: (user: UserMeSlim) => boolean;
  snoozeDays: number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function snoozedUntil(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export default function DashboardPage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({ page: true });
  // Which view the add-tournament modal opens on, or null while it's closed.
  const [modalView, setModalView] = useState<"choose" | "create" | "join" | null>(null);

  // Not saved anywhere: the dashboard isn't one tournament's, so there's no
  // display config to keep them in, and each visit starts from everything.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TournamentsFilterState>(() =>
    emptyFilterState(TOURNAMENTS_FILTER_KEYS),
  );
  const [sortRules, setSortRules] =
    useState<SortRule<TournamentSortField>[]>(DEFAULT_TOURNAMENT_SORT);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);

  const visibleTournaments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tournaments.filter(
      (t) =>
        (!q ||
          t.name.toLowerCase().includes(q) ||
          (t.short_name ?? "").toLowerCase().includes(q)) &&
        tournamentPassesFilters(t, filters),
    );
    return sortRows(list, sortRules, tournamentSortValue, tournamentSortTiebreak);
  }, [tournaments, search, filters, sortRules]);

  // Upcoming above archived: the archived ones have run, and a soonest-first
  // sort would otherwise put them at the top. Each section counts against its
  // own total, so a filter reads as "2 of 3 upcoming", not of everything.
  const sections = [
    { title: "Upcoming", archived: false },
    { title: "Archived", archived: true },
  ].map(({ title, archived }) => ({
    title,
    shown: visibleTournaments.filter((t) => t.is_archived === archived),
    total: tournaments.filter((t) => t.is_archived === archived).length,
  }));

  const [dismissedBanners, setDismissedBanners] = useState<Record<number, string>>(() => {
    const dismissed =
      typeof window !== "undefined" ? localStorage.getItem("dismissedBanners") : "{}";
    if (!dismissed) return {};
    try {
      return JSON.parse(dismissed);
    } catch {
      return {};
    }
  });

  const [tooltipStatus, setTooltipStatus] = useState<Record<string, TooltipStatus>>({
    resendEmail: "idle",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const user = useAuth().user;

  const resendEmailTooltipMessages: Partial<Record<TooltipStatus, string | undefined>> = {
    success: "Email sent successfully. Please check your inbox.",
    error: errors.resendEmail ?? undefined,
  };

  const bannerRules: BannerRule[] = [
    {
      id: 1,
      variant: "warning",
      message: "Please verify your email address",
      condition: (user) => !user.email_verified,
      snoozeDays: 1,
      action: (
        <Tooltip status={tooltipStatus.resendEmail} message={resendEmailTooltipMessages}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoading((l) => ({ ...l, "verify-email": true }));
              authApi
                .sendEmailVerification()
                .then(() => setTooltipStatus((s) => ({ ...s, resendEmail: "success" })))
                .catch((err) => {
                  const message = err instanceof ApiError ? err.message : "Something went wrong";
                  setTooltipStatus((s) => ({ ...s, resendEmail: "error" }));
                  setErrors({ resendEmail: message });
                })
                .finally(() => setLoading((l) => ({ ...l, "verify-email": false })));
            }}
            loading={loading["verify-email"]}
          >
            Resend Email
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 2,
      variant: "warning",
      message: "Your profile is incomplete",
      condition: (user) => !user.is_profile_complete,
      snoozeDays: 3,
      action: (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => user && router.push(`/profile/${user.id}/edit`)}
        >
          Complete Profile
        </Button>
      ),
    },
  ];

  // Snoozes are measured against when the page loaded; they last days, not minutes.
  const [loadedAt] = useState(() => new Date().toISOString());
  const activeBanners = bannerRules.filter((e) => {
    if (!user) return false;
    return e.condition(user) && loadedAt >= (dismissedBanners[e.id] ?? "");
  });

  useEffect(() => {
    tournamentsApi
      .list()
      .then(setTournaments)
      .catch(() => {})
      .finally(() => setLoading((l) => ({ ...l, page: false })));
  }, []);

  function handleCreated(t: Tournament) {
    setTournaments((prev) => [...prev, { ...t, event_count: 0, volunteer_count: 0 }]);
    setModalView(null);
    router.push(`/dashboard/tournaments/${t.id}/overview`);
  }

  function dismissBanner(id: number, snoozeDays: number) {
    const dismissed = {
      ...dismissedBanners,
      [id]: snoozedUntil(snoozeDays),
    };
    setDismissedBanners(dismissed);
    localStorage.setItem("dismissedBanners", JSON.stringify(dismissed));
  }

  return (
    <>
      {/* The shell (Topbar, rail, scrolling main) lives in dashboard/layout.tsx.
          The 960px cap is this page's own: the cards are a masonry grid and
          read better centred than stretched across a wide display. */}
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        {activeBanners.length > 0 &&
          activeBanners.map(({ id, variant, message, action, snoozeDays }) => {
            return (
              <div key={id} style={{ marginBottom: "15px" }}>
                <Banner
                  variant={variant}
                  message={message}
                  action={action}
                  onDismiss={() => dismissBanner(id, snoozeDays)}
                />
              </div>
            );
          })}

        <PageHeader
          heading="Tournaments"
          action={
            <Button variant="primary" size="md" onClick={() => setModalView("choose")}>
              <IconPlus />
              Add Tournament
            </Button>
          }
        />

        {loading.page ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: "180px",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  opacity: 0.5,
                }}
              />
            ))}
          </div>
        ) : tournaments.length === 0 ? (
          <Card radius="lg" style={{ padding: "8px" }}>
            <EmptyState
              icon={<IconTrophy size={28} />}
              title="No tournaments yet"
              description="Join one with an invite, or create your own."
              action={
                <div style={{ display: "flex", gap: "10px" }}>
                  <Button variant="primary" size="sm" onClick={() => setModalView("join")}>
                    Join with an invite
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setModalView("create")}>
                    <IconPlus size={12} /> Create tournament
                  </Button>
                </div>
              }
            />
          </Card>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input
                  aria-label="Search tournaments"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClear={() => setSearch("")}
                  placeholder="Search tournaments"
                  icon={<IconSearch size={14} />}
                  font="sans"
                  size="md"
                  variant="secondary"
                  fullWidth
                />
              </div>
              <FilterButton
                active={isFilterActive(filters)}
                onOpen={() => setShowFilterModal(true)}
                onClear={() => setFilters(emptyFilterState(TOURNAMENTS_FILTER_KEYS))}
              />
              <SortButton
                active={!sameSortRules(sortRules, DEFAULT_TOURNAMENT_SORT)}
                onOpen={() => setShowSortModal(true)}
                onReset={() => setSortRules(DEFAULT_TOURNAMENT_SORT)}
              />
            </div>
            {visibleTournaments.length === 0 ? (
              <Card radius="lg" style={{ padding: "8px", marginTop: "16px" }}>
                <EmptyState
                  icon={<IconSearch size={28} />}
                  title="No matching tournaments"
                  description="Try adjusting your search or filters."
                />
              </Card>
            ) : (
              sections
                .filter((section) => section.shown.length > 0)
                .map((section) => (
                  <section key={section.title} style={{ marginTop: "20px" }}>
                    <h2
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: "var(--color-text-tertiary)",
                        margin: "0 0 10px",
                      }}
                    >
                      {section.title} —{" "}
                      {section.shown.length === section.total
                        ? section.total
                        : `${section.shown.length} of ${section.total}`}
                    </h2>
                    {/* Masonry, not a grid: a multi-site tournament listing a row
                        per track is legitimately taller than a single-day one,
                        and a grid would stretch every card to match it. The
                        order is the sort's, which plain CSS columns would
                        scramble — see MasonryGrid. */}
                    <MasonryGrid minColumnWidth={280} gap={16}>
                      {section.shown.map((t) => (
                        <TournamentCard
                          key={t.id}
                          tournament={t}
                          onClick={() => router.push(`/dashboard/tournaments/${t.id}/overview`)}
                        />
                      ))}
                    </MasonryGrid>
                  </section>
                ))
            )}
          </>
        )}
      </div>

      {showFilterModal && (
        <TournamentsFilterModal
          filters={filters}
          onApply={setFilters}
          onClose={() => setShowFilterModal(false)}
        />
      )}
      {showSortModal && (
        <SortModal
          title="Sort tournaments"
          fields={TOURNAMENT_SORT_OPTIONS}
          rules={sortRules}
          defaults={DEFAULT_TOURNAMENT_SORT}
          tiebreakLabel={TOURNAMENT_SORT_TIEBREAK}
          onApply={(next) => setSortRules(next as SortRule<TournamentSortField>[])}
          onClose={() => setShowSortModal(false)}
        />
      )}

      {modalView && (
        <AddTournamentModal
          initialView={modalView === "choose" ? undefined : modalView}
          onClose={() => setModalView(null)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
