import type { Metadata } from "next";
import { JoinPage } from "@/components/auth/JoinPage";
import { fetchJoinPreview, joinPreviewFactLines, joinPreviewTitle } from "@/lib/joinPreview";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}): Promise<Metadata> {
  const { code } = await searchParams;
  const preview = code ? await fetchJoinPreview(code) : null;
  if (!preview) return {};

  const title = joinPreviewTitle(preview);
  const description = `You’re invited to join ${title} on NEXUS. ${joinPreviewFactLines(preview).join("; ")}`;
  const query = `?code=${encodeURIComponent(code ?? "")}`;

  return {
    title: `Join ${title} · NEXUS`,
    description,
    openGraph: {
      siteName: "NEXUS",
      type: "website",
      url: `/join${query}`,
      title,
      description,
      images: [{ url: `/join/og-image${query}`, width: 1200, height: 630, alt: title }],
    },
  };
}

export default function Page() {
  return <JoinPage />;
}
