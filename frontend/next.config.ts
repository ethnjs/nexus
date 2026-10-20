import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
