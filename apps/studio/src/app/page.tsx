import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, EmptyState, PageHeader } from "@cms/ui";
import { currentUser, sitesForCurrentUser } from "@/server/context";

/**
 * The site picker.
 *
 * Every studio URL is scoped to a site, so this is the only screen that is
 * not. A user on exactly one site never sees it — sending them here to click
 * their only option is a step that exists for the software's benefit.
 */
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const memberships = await sitesForCurrentUser();

  if (memberships.length === 1) {
    redirect(`/${memberships[0]!.site.slug}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <PageHeader
        title="Your sites"
        description={`Signed in as ${user.email}.`}
      />

      {memberships.length === 0 ? (
        <EmptyState
          title="No sites yet"
          description="You are not a member of any site. Ask an owner to invite you, or seed one locally with `pnpm db:seed`."
        />
      ) : (
        <ul className="mt-8 grid gap-3">
          {memberships.map(({ site, role }) => (
            <li key={site.id}>
              <Link
                href={`/${site.slug}`}
                className="block rounded-lg ui-focus-ring"
              >
                <Card>
                  <CardContent className="flex items-baseline justify-between gap-4 py-4">
                    <div>
                      <div className="font-medium">{site.name}</div>
                      {/* The consuming origin, not the studio's — it is the
                          thing that makes one site distinguishable from another. */}
                      <div className="text-xs text-[var(--color-ink-muted)]">
                        {site.baseUrl}
                      </div>
                    </div>
                    <span className="text-xs text-[var(--color-ink-muted)]">{role}</span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
