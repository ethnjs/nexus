import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };

// ImageResponse can't read CSS variables, so these mirror the tokens in app/globals.css.
export const OG_COLORS = {
  bg: "#f7f7f5",
  surface: "#ffffff",
  border: "#e2e2de",
  borderStrong: "#c8c8c2",
  accentSubtle: "#f0f0ec",
  textPrimary: "#0a0a0a",
  textSecondary: "#6b6b65",
  textTertiary: "#9b9b93",
};

// ImageResponse takes only raw ttf/otf/woff data, not the woff2 next/font serves to the site.
const FONT_FILES = [
  { name: "Serif", weight: 400, path: "@fontsource/gelasio/files/gelasio-latin-400-normal.woff" },
  { name: "Sans", weight: 400, path: "geist/dist/fonts/geist-sans/Geist-Regular.ttf" },
  { name: "Sans", weight: 500, path: "geist/dist/fonts/geist-sans/Geist-Medium.ttf" },
] as const;

export function ogFonts() {
  return Promise.all(
    FONT_FILES.map(async ({ name, weight, path }) => ({
      name,
      weight,
      style: "normal" as const,
      data: await readFile(join(process.cwd(), "node_modules", path)),
    })),
  );
}

/** The home page's backdrop: a grid that fades out behind the content. */
export function OgFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: OG_COLORS.bg,
        fontFamily: "Sans",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundImage: `linear-gradient(to right, ${OG_COLORS.borderStrong} 1px, transparent 1px), linear-gradient(to bottom, ${OG_COLORS.borderStrong} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundImage: `radial-gradient(ellipse 70% 70% at 50% 50%, ${OG_COLORS.bg} 0%, ${OG_COLORS.bg} 45%, ${OG_COLORS.bg}00 100%)`,
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: "64px 96px",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
