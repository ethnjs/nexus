import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/og.tsx reads these with a runtime path, which file tracing can't follow.
  outputFileTracingIncludes: {
    "/join/og-image": [
      "./node_modules/geist/dist/fonts/geist-sans/Geist-{Regular,Medium}.ttf",
      "./node_modules/@fontsource/gelasio/files/gelasio-latin-400-normal.woff",
    ],
  },
  // Every unconditional redirect lives here. They run before proxy.ts, so a
  // signed-out visitor on the short form link still reaches /view's sign-in card.
  async redirects() {
    return [
      { source: "/forms/:formId", destination: "/forms/:formId/view", permanent: false },
      {
        source: "/dashboard/tournaments/:id/settings",
        destination: "/dashboard/tournaments/:id/settings/general",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
