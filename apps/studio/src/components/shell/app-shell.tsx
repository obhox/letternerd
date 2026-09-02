"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { SiteSwitcher, type SwitchableSite } from "./site-switcher";
import { UserMenu } from "@/components/user-menu";

/**
 * The two-column frame.
 *
 * Fixed sidebar, scrolling content. Below the `lg` breakpoint the sidebar
 * becomes a drawer rather than collapsing to icons: an icon rail forces
 * someone to learn ten glyphs to use a tool they may open once a week, and the
 * labels are the navigation.
 */
export function AppShell({
  current,
  sites,
  email,
  children,
}: {
  current: SwitchableSite;
  sites: SwitchableSite[];
  email: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating must close the drawer, or the destination is hidden behind it.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      {/* Skip link: the sidebar is a long list of links, and a keyboard user
          should not have to tab through it on every page. */}
      <a
        href="#content"
        className="ui-focus-ring sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <aside
        id="site-sidebar"
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] flex-col",
          "border-r border-[var(--color-border)] bg-[var(--color-surface)]",
          "transition-transform duration-150 lg:translate-x-0",
          open ? "translate-x-0 shadow-[var(--shadow-overlay)]" : "-translate-x-full",
        ].join(" ")}
      >
        <SiteSwitcher current={current} sites={sites} />
        <div className="ui-scroll flex-1 overflow-y-auto">
          <Sidebar slug={current.slug} role={current.role} />
        </div>
        <UserMenu email={email} role={current.role} />
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-[oklch(0_0_0/0.4)] lg:hidden"
        />
      )}

      <div className="lg:pl-[var(--sidebar-width)]">
        <header className="sticky top-0 z-20 flex h-[var(--header-height)] items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="site-sidebar"
            className="ui-focus-ring rounded p-1.5 text-[var(--color-ink-secondary)] hover:bg-[var(--color-muted)]"
          >
            <span className="sr-only">Open navigation</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          <span className="truncate text-sm font-semibold">{current.name}</span>
        </header>

        <main id="content" className="mx-auto w-full max-w-[var(--content-max)] px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
