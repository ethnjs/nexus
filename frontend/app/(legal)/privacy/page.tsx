import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Privacy Policy | NEXUS" };

export default function PrivacyPage() {
  return <LegalDocument file="privacy.md" />;
}
