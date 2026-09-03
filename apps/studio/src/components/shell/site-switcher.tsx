"use client";

import Link from "next/link";
import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { cn } from "@cms/ui";

export interface SwitchableSite {
  slug: string;
  name: string;
  baseUrl: string;
  role: string;
}

/**
 * Site identity and switching, in the sidebar's head.
 *
 * The origin is shown under the name because it is the thing that
 * distinguishes two sites from each other — and because every canonical URL,
 * sitemap entry and feed link this site emits is built from it, so an author
 * seeing the wrong origin here should stop before publishing.
 */
export function SiteSwitcher({
  current,
  sites,
}: {
  current: SwitchableSite;
  sites: SwitchableSite[];
}) {
  const [open, setOpen] = useState(false);
  const others = sites.filter((s) => s.slug !== current.slug);

  return (
    <div className="relative border-b border-[var(--color-border)] px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="ui-focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--color-muted)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold tracking-tight text-[var(--color-ink)]">
            {current.name}
          </span>
          <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
            {current.baseUrl.replace(/^https?:\/\//, "")}
          </span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="size-3 shrink-0 text-[var(--color-ink-faint)]"
        >
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>

      {open && (
        <ul
          role="menu"
          className="absolute inset-x-3 top-full z-30 mt-1 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-overlay)]"
        >
          {others.map((site) => (
            <li key={site.slug} role="none">
              <Link
                role="menuitem"
                href={`/${site.slug}`}
                onClick={() => setOpen(false)}
                className="ui-focus-ring-inset block px-3 py-2 hover:bg-[var(--color-muted)]"
              >
                <span className="block truncate text-sm">{site.name}</span>
                <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
                  {site.baseUrl.replace(/^https?:\/\//, "")}
                </span>
              </Link>
            </li>
          ))}
          {/* Every signed-in user may create a site of their own — see
              `packages/auth/src/sites.ts` — so this is not gated on role. */}
          <li role="none">
            <Link
              role="menuitem"
              href="/sites/new"
              onClick={() => setOpen(false)}
              className={cn(
                "ui-focus-ring-inset flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-ink-secondary)] hover:bg-[var(--color-muted)]",
                others.length > 0 && "border-t border-[var(--color-border)]",
              )}
            >
              <PlusIcon className="size-3.5 shrink-0" aria-hidden="true" />
              Add site
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
