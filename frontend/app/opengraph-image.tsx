import { ImageResponse } from "next/og";
import { OG_COLORS, OG_SIZE, OgFrame, ogFonts } from "@/lib/og";

export const alt = "NEXUS — Tournament Logistics Dashboard for Science Olympiad";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    <OgFrame>
      <div
        style={{
          fontFamily: "Serif",
          fontSize: 200,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: OG_COLORS.textPrimary,
        }}
      >
        NEXUS
      </div>
      <div
        style={{
          marginTop: 32,
          fontSize: 34,
          letterSpacing: "0.01em",
          color: OG_COLORS.textSecondary,
        }}
      >
        Tournament Logistics Dashboard for Science Olympiad
      </div>
    </OgFrame>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}
