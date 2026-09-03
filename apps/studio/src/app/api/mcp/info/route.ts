import { serverInfo } from "../catalog";

/**
 * What a client will see once it connects, without connecting.
 *
 * Unauthenticated on purpose. Everything here — the server's name and version,
 * the transport, and the names and one-line purposes of its tools — is what any
 * holder of any key reads back in the first `tools/list` call, and it is the
 * same list this product's marketing would print. No site is named, no content
 * is reachable, and no key is required to learn that a CMS has a
 * `publish_document` tool.
 *
 * The settings screen renders this catalogue from the same function rather than
 * fetching this URL: a server component calling back into its own origin is a
 * request a deployment has to be able to make of itself, and the answer is
 * identical by construction. The route exists so an operator can check what a
 * client will negotiate with `curl`, before wiring up any key.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(serverInfo(), {
    // The registry is fixed at build time, so this is safe to hold briefly;
    // short enough that a deploy is reflected before anyone notices.
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" },
  });
}
