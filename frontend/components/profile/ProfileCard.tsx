import { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

export function ProfileCard({ children }: { children: ReactNode }) {
  return (
    <Card radius="lg" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "28px" }}>
      {children}
    </Card>
  );
}
