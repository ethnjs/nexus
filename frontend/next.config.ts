import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The short form link managers share. Config redirects run before proxy.ts,
  // so a signed-out visitor still reaches /view's sign-in card.
  async redirects() {
    return [{ source: "/forms/:formId", destination: "/forms/:formId/view", permanent: false }];
  },
};

export default nextConfig;
