import type { Metadata } from "next";
import { env } from "@/env";
import { currentUser, studioContext } from "@/server/context";
import { SecurityPanel } from "@/components/settings/security-panel";

export const metadata: Metadata = { title: "Security" };

/**
 * Two-factor enrolment for the signed-in account.
 *
 * This is the one settings screen every member may open — it is about their
 * own account, not the site — and the one screen an owner who has not yet
 * enrolled is allowed to reach when enrolment is required. The gate that
 * sends them here lives in `studioContext`; this page asks it to stand aside
 * for itself, or nobody could ever satisfy it.
 */
export default async function SecurityPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ site: slug }, query] = await Promise.all([params, searchParams]);
  const ctx = await studioContext(slug, { allowUnenrolled: true });
  const user = await currentUser();
  const enabled = Boolean((user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled);
  const requiredRole = env.CMS_REQUIRE_2FA_ROLE;

  return (
    <SecurityPanel
      siteSlug={slug}
      enabled={enabled}
      required={query.required === "1"}
      requiredRole={requiredRole}
      role={ctx.role}
    />
  );
}
