import { AppShell } from "@/components/shell/app-shell";
import { currentUser, sitesForCurrentUser, studioContext } from "@/server/context";

/**
 * The shell every site-scoped screen renders inside.
 *
 * Context is resolved here rather than per page, so membership is checked once
 * per navigation and no screen can forget to check it — the layout does not
 * render at all for someone with no business on this site.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ site: string }>;
}) {
  const { site: slug } = await params;
  const [{ site, role }, memberships, user] = await Promise.all([
    studioContext(slug),
    sitesForCurrentUser(),
    currentUser(),
  ]);

  const sites = memberships.map((m) => ({
    slug: m.site.slug,
    name: m.site.name,
    baseUrl: m.site.baseUrl,
    role: m.role,
  }));

  return (
    <AppShell
      current={{ slug: site.slug, name: site.name, baseUrl: site.baseUrl, role }}
      sites={sites}
      email={user?.email ?? ""}
    >
      {children}
    </AppShell>
  );
}
