import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";
import { fetchJoinPreview, joinPreviewTitle } from "@/lib/joinPreview";
import { OG_COLORS, OG_SIZE, OgFrame, ogFonts } from "@/lib/og";
import { tournamentFactRows } from "@/lib/tournamentDisplay";

const MAX_FACT_ROWS = 3;
const ICON_SIZE = 26;

function titleSize(title: string): number {
  if (title.length <= 26) return 88;
  if (title.length <= 40) return 72;
  return 58;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "6px 18px",
        borderRadius: 999,
        border: `1px solid ${OG_COLORS.border}`,
        background: OG_COLORS.accentSubtle,
        fontSize: 24,
        fontWeight: 500,
        color: OG_COLORS.textSecondary,
      }}
    >
      {children}
    </div>
  );
}

function Fact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

export async function GET(req: NextRequest) {
  const preview = await fetchJoinPreview(req.nextUrl.searchParams.get("code") ?? "");
  if (!preview) return new Response(null, { status: 404 });

  const title = joinPreviewTitle(preview);
  const rows = tournamentFactRows(preview, "long").slice(0, MAX_FACT_ROWS);
  const pills = [
    preview.state,
    preview.level[0].toUpperCase() + preview.level.slice(1),
    ...preview.division.map((d) => `Division ${d}`),
  ];

  return new ImageResponse(
    <OgFrame>
      <div
        style={{
          fontFamily: "Serif",
          fontSize: 40,
          letterSpacing: "-0.02em",
          color: OG_COLORS.textPrimary,
        }}
      >
        NEXUS
      </div>
      <div
        style={{
          marginTop: 16,
          fontFamily: "Serif",
          fontSize: titleSize(title),
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          color: OG_COLORS.textPrimary,
          lineClamp: 2,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          marginTop: 28,
          fontSize: 30,
          color: OG_COLORS.textSecondary,
        }}
      >
        {rows.map((row) => (
          <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {row.name && (
              <span style={{ fontWeight: 500, color: OG_COLORS.textTertiary }}>{row.name}</span>
            )}
            {row.place && <Fact icon={<IconLocation size={ICON_SIZE} />}>{row.place}</Fact>}
            {row.dates && <Fact icon={<IconCalendar size={ICON_SIZE} />}>{row.dates}</Fact>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
        {pills.map((pill) => (
          <Pill key={pill}>{pill}</Pill>
        ))}
      </div>
    </OgFrame>,
    {
      ...OG_SIZE,
      fonts: await ogFonts(),
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    },
  );
}
