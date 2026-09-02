import type { Metadata } from "next";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { SeoForm } from "@/components/settings/seo-form";
import type { SiteSettingsView } from "@/components/settings/types";

export const metadata: Metadata = { title: "SEO settings" };

type SiteRow = SiteSettingsView & Record<string, unknown>;

export default async function SeoSettingsPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);
  const site = await dispatchOrThrow<SiteRow>(ctx, "get_site", {});

  return (
    <SeoForm
      siteSlug={slug}
      site={{
        name: site.name,
        baseUrl: site.baseUrl,
        blogBasePath: site.blogBasePath,
        locale: site.locale,
        orgName: site.orgName,
        orgLogoUrl: site.orgLogoUrl,
        orgSameAs: site.orgSameAs,
        twitterHandle: site.twitterHandle,
        feedTitle: site.feedTitle,
        feedDescription: site.feedDescription,
        robotsExtra: site.robotsExtra,
        llmsIntro: site.llmsIntro,
      }}
    />
  );
}
