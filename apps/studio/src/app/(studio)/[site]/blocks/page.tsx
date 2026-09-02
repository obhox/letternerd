import type { Metadata } from "next";
import { DocumentListScreen } from "@/components/documents/document-list-screen";
import type { RawSearchParams } from "@/components/documents/search-params";

export const metadata: Metadata = { title: "Blocks" };

export default async function BlocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  // Both are promises in Next 16, and neither depends on the other.
  const [{ site }, resolvedSearchParams] = await Promise.all([params, searchParams]);

  return <DocumentListScreen siteSlug={site} type="block" searchParams={resolvedSearchParams} />;
}
