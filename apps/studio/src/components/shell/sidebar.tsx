"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@cms/ui";
import { isCurrent, visibleGroups } from "./nav-items";

export function Sidebar({
  slug,
  role,
  onNavigate,
}: {
  slug: string;
  role: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = `/${slug}`;
  const groups = visibleGroups(role);

  return (
    <nav aria-label="Sections" className="flex flex-col gap-6 px-3 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          <h2 className="px-2.5 pb-1.5 text-2xs font-medium uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            {group.label}
          </h2>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const current = isCurrent(pathname, base, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={`${base}${item.href}`}
                    aria-current={current ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "ui-focus-ring-inset block rounded px-2.5 py-1.5 text-sm transition-colors",
                      current
                        ? // Filled rather than tinted: with no hue available,
                          // a solid block is the unambiguous "you are here".
                          "bg-[var(--color-accent)] font-medium text-[var(--color-accent-ink)]"
                        : "text-[var(--color-ink-secondary)] hover:bg-[var(--color-muted)] hover:text-[var(--color-ink)]",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
