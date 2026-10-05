"use client";

import { ReactNode, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { CollapsibleHeader } from "@/components/ui/CollapsibleHeader";
import { useSettingsPages, type SettingsPageKey } from "@/lib/useSettingsPages";

/**
 * A tournament settings page's header. Folded, the Topbar reads
 * "Settings / General" with the other settings pages in the dropdown, the
 * way a tabbed page's crumb offers its tabs — the sidebar's Settings group,
 * reachable without unfolding the header.
 */
export function SettingsPageHeader({ page, heading, action }: {
  page: SettingsPageKey;
  heading: string;
  action?: ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const pages = useSettingsPages(String(params.id));

  const tabs = useMemo(() => pages.map((p) => ({ key: p.key, label: p.label })), [pages]);
  const go = useCallback((key: string) => {
    const target = pages.find((p) => p.key === key);
    if (target) router.push(target.href);
  }, [pages, router]);
  const crumb = useMemo(() => ({ title: "Settings", tabs, activeKey: page, onChange: go }), [tabs, page, go]);

  return <CollapsibleHeader heading={heading} subheading="Tournament Settings" action={action} crumb={crumb} />;
}
