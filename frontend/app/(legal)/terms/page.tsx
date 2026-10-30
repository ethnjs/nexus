import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Terms of Service | NEXUS" };

export default function TermsPage() {
  return <LegalDocument file="terms.md" />;
}
