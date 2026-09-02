"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@cms/ui";

/**
 * Sub-navigation for the settings screens.
 *
 * Real routes rather than a client-side tab component: each section loads its
 * own data on the server, and a settings URL is the kind of thing people
 * bookmark and paste to each other ("the API keys page"). A tab widget would
 * make all five sections one page's worth of queries and give none of them an
 * address.
 */
const TABS = [
  { segment: "", label: "General" },
  { segment: "/seo", label: "SEO" },
  { segment: "/api-keys", label: "API keys" },
  { segment: "/members", label: "Members" },
  { segment: "/webhooks", label: "Webhooks" },
] as const;

export function SettingsTabs({ siteSlug }: { siteSlug: string }) {
  const pathname = usePathname();
  const base = `/${siteSlug}/settings`;

  return (
    <nav aria-label="Settings sections" className="ui-scroll overflow-x-auto">
      <ul className="flex items-center gap-4 border-b border-[var(--color-border)]">
        {TABS.map((tab) => {
          const href = `${base}${tab.segment}`;
          // General is the index, so it must match exactly or it would stay
          // marked current on every other tab.
          const current = tab.segment === "" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={tab.segment}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "ui-focus-ring-inset -mb-px inline-block border-b-2 px-0.5 pb-2 text-sm font-medium whitespace-nowrap transition-colors",
                  current
                    ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                    : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
