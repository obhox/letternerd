import type { Metadata } from "next";
import { DocumentListScreen } from "@/components/documents/document-list-screen";
import type { RawSearchParams } from "@/components/documents/search-params";

export const metadata: Metadata = { title: "Posts" };

export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  // Both are promises in Next 16, and neither depends on the other.
  const [{ site }, resolvedSearchParams] = await Promise.all([params, searchParams]);

  return <DocumentListScreen siteSlug={site} type="post" searchParams={resolvedSearchParams} />;
}
