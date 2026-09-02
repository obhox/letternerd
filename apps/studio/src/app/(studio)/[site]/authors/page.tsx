import { notFound } from "next/navigation";
import { can } from "@cms/core/roles";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { AuthorsScreen } from "@/components/editorial/authors-screen";
import type { AuthorRow } from "@/components/editorial/types";
import { deleteAuthorAction, saveAuthorAction } from "./actions";

export const metadata = { title: "Authors" };

/**
 * Reads happen here, in the server component, through the same dispatch the
 * MCP server uses. The screen receives data and two server actions and never
 * learns that a database exists.
 *
 * The role check is presentational rather than protective — every capability
 * re-checks — but a screen an author cannot use should not render an empty
 * shell at them, and `notFound` matches how the rest of the studio answers a
 * route you have no business on.
 */
export default async function AuthorsPage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  const ctx = await studioContext(site);
  if (!can.manageAuthors(ctx.role)) notFound();

  const { authors } = await dispatchOrThrow<{ authors: AuthorRow[] }>(ctx, "list_authors", {
    includeInactive: true,
  });

  return (
    <AuthorsScreen
      site={site}
      authors={authors}
      saveAction={saveAuthorAction}
      deleteAction={deleteAuthorAction}
    />
  );
}
