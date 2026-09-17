import { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import styles from "@/components/profile/Profile.module.css";

export function ProfileCard({ children }: { children: ReactNode }) {
  return (
    <Card radius="lg" className={styles.card}>
      {children}
    </Card>
  );
}
