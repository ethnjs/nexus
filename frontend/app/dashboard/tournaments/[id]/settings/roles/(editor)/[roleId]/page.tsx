"use client";

import { useParams } from "next/navigation";

export default function RoleDetailPage() {
  const params = useParams();
  return (
    <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
      Role #{params.roleId} editor — coming soon.
    </p>
  );
}
