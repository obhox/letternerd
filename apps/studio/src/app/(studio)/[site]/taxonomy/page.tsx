import { notFound } from "next/navigation";
import { can } from "@cms/core/roles";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { TaxonomyScreen } from "@/components/editorial/taxonomy-screen";
import type { TermRow } from "@/components/editorial/types";
import { deleteTermAction, saveTermAction } from "./actions";

export const metadata = { title: "Taxonomy" };

/**
 * All three kinds are fetched here rather than lazily per tab.
 *
 * They are small — tens of rows each — and fetching them together means
 * switching tabs is instant and the counts on every tab are consistent with
 * one another, which they would not be if each tab loaded at a different
 * moment.
 */
export default async function TaxonomyPage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  const ctx = await studioContext(site);
  if (!can.manageTaxonomy(ctx.role)) notFound();

  const [tags, categories, entities] = await Promise.all([
    dispatchOrThrow<{ terms: TermRow[] }>(ctx, "list_terms", { kind: "tag" }),
    dispatchOrThrow<{ terms: TermRow[] }>(ctx, "list_terms", { kind: "category" }),
    dispatchOrThrow<{ terms: TermRow[] }>(ctx, "list_terms", { kind: "entity" }),
  ]);

  return (
    <TaxonomyScreen
      site={site}
      tags={tags.terms}
      categories={categories.terms}
      entities={entities.terms}
      saveAction={saveTermAction}
      deleteAction={deleteTermAction}
    />
  );
}
