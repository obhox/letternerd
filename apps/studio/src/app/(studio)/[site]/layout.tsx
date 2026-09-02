import Link from "next/link";
import { studioContext } from "@/server/context";
import { SiteNav } from "@/components/site-nav";
import { UserMenu } from "@/components/user-menu";

/**
 * The shell every site-scoped screen renders inside.
 *
 * Resolving the context here rather than in each page means membership is
 * checked once per navigation and a page cannot forget to check it — the
 * layout will not render if the user has no business on this site.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ site: string }>;
}) {
  const { site: slug } = await params;
  const { site, role } = await studioContext(slug);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-14 items-center gap-4 px-4">
          <Link href="/" className="rounded ui-focus-ring text-sm font-semibold">
            {site.name}
          </Link>
          <span
            className="truncate text-xs text-[var(--color-ink-muted)]"
            title={site.baseUrl}
          >
            {site.baseUrl}
          </span>
          <div className="ml-auto">
            <UserMenu role={role} />
          </div>
        </div>
        <SiteNav slug={site.slug} role={role} />
      </header>

      <main className="px-4 py-6">{children}</main>
    </div>
  );
}
