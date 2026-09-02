"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can } from "@cms/core/roles";
import { cn } from "@cms/ui";

/**
 * Primary navigation.
 *
 * Entries the current role cannot use are omitted rather than disabled. A
 * disabled link invites a support question; an absent one does not, and the
 * server refuses the route regardless — this is presentation, not enforcement.
 */
const ITEMS = [
  { href: "", label: "Overview" },
  { href: "/posts", label: "Posts" },
  { href: "/pages", label: "Pages" },
  { href: "/blocks", label: "Blocks" },
  { href: "/media", label: "Media" },
  { href: "/insights", label: "Insights" },
  { href: "/authors", label: "Authors", needs: can.manageAuthors },
  { href: "/taxonomy", label: "Taxonomy", needs: can.manageTaxonomy },
  { href: "/redirects", label: "Redirects", needs: can.manageRedirects },
  { href: "/settings", label: "Settings", needs: can.manageSite },
] as const;

export function SiteNav({ slug, role }: { slug: string; role: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;

  return (
    <nav aria-label="Site sections" className="ui-scroll overflow-x-auto px-2">
      <ul className="flex items-center gap-1">
        {ITEMS.filter((item) => !("needs" in item) || item.needs(role)).map((item) => {
          const href = `${base}${item.href}`;
          // Overview matches only exactly; the others match their subtree, so
          // editing a post keeps "Posts" marked current.
          const current = item.href === "" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={item.href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "ui-focus-ring-inset inline-block whitespace-nowrap px-3 py-2 text-sm",
                  current
                    ? "border-b-2 border-[var(--color-accent)] font-medium text-[var(--color-ink)]"
                    : "border-b-2 border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
