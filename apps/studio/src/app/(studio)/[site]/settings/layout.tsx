import { PageHeader } from "@cms/ui";
import { SettingsTabs } from "@/components/settings/settings-tabs";

/**
 * The settings shell.
 *
 * Membership and the owner role are re-checked by every capability these pages
 * call, so this layout does no authorization of its own — the studio's site
 * nav simply omits the link for non-owners, and the server refuses regardless.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Settings"
        description="Configuration, credentials and people for this site. Owner access only."
      >
        <SettingsTabs siteSlug={site} />
      </PageHeader>
      <div className="pt-4">{children}</div>
    </div>
  );
}
