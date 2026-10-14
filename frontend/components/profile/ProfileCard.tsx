import type { ReactNode } from "react";
import styles from "@/components/profile/Profile.module.css";
import { Card } from "@/components/ui/Card";

export function ProfileCard({ children }: { children: ReactNode }) {
  return (
    <Card radius="lg" className={styles.card}>
      {children}
    </Card>
  );
}
