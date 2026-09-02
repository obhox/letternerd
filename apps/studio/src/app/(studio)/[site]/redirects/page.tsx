import { notFound } from "next/navigation";
import { can } from "@cms/core/roles";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { RedirectsScreen } from "@/components/editorial/redirects-screen";
import type {
  RedirectChain,
  RedirectRow,
  SlugHistoryRow,
} from "@/components/editorial/types";
import { deleteRedirectAction, saveRedirectAction } from "./actions";

export const metadata = { title: "Redirects" };

interface ListRedirectsResult {
  redirects: RedirectRow[];
  slugHistory: SlugHistoryRow[];
  chains: RedirectChain[];
  blogBasePath: string;
}

/**
 * Both lists and the chain analysis come from one capability call.
 *
 * Chains are detected across the two sets together, because the most common
 * one in practice spans them: a hand-written rule pointing at a URL that a
 * later slug change has since moved on again.
 */
export default async function RedirectsPage({
  params,
}: {
  params: Promise<{ site: string }>;
}) {
  const { site } = await params;
  const ctx = await studioContext(site);
  if (!can.manageRedirects(ctx.role)) notFound();

  const data = await dispatchOrThrow<ListRedirectsResult>(ctx, "list_redirects", {});

  return (
    <RedirectsScreen
      site={site}
      redirects={data.redirects}
      slugHistory={data.slugHistory}
      chains={data.chains}
      blogBasePath={data.blogBasePath}
      saveAction={saveRedirectAction}
      deleteAction={deleteRedirectAction}
    />
  );
}
