"use client";

import Link from "next/link";
import { useState } from "react";
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
        disabled={others.length === 0}
        aria-expanded={others.length === 0 ? undefined : open}
        aria-haspopup={others.length === 0 ? undefined : "menu"}
        className={cn(
          "ui-focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
          others.length > 0 && "hover:bg-[var(--color-muted)]",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold tracking-tight text-[var(--color-ink)]">
            {current.name}
          </span>
          <span className="block truncate text-2xs text-[var(--color-ink-faint)]">
            {current.baseUrl.replace(/^https?:\/\//, "")}
          </span>
        </span>
        {others.length > 0 && (
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="size-3 shrink-0 text-[var(--color-ink-faint)]"
          >
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        )}
      </button>

      {open && others.length > 0 && (
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
        </ul>
      )}
    </div>
  );
}
