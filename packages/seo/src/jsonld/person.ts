import type { JsonLdObject, SeoAuthor, SeoSite } from "../types.js";
import { absoluteUrl, joinPath } from "../url.js";
import { SCHEMA_CONTEXT, listOrUndefined, prune } from "./shared.js";

/**
 * Authors live at `/authors/<slug>` on the consuming site unless the author
 * record names its own URL. There is no setting for this path because there is
 * nothing to vary: the SDK routes it, and an author who really lives elsewhere
 * — a staff page, a personal site — says so in `author.url`, which then also
 * becomes the node's identity.
 */
export function authorPath(author: Pick<SeoAuthor, "slug">): string {
  return joinPath("/authors", author.slug);
}

export function personId(author: SeoAuthor, site: SeoSite): string {
  return `${author.url ?? absoluteUrl(site, authorPath(author))}#person`;
}

/**
 * A full Person node, never a bare name string.
 *
 * This is the E-E-A-T lever, and it is the one place where the difference
 * between "author": "Jane Doe" and a node carrying `jobTitle`, `knowsAbout`
 * and `sameAs` links to profiles an engine has already indexed is worth real
 * ranking. A string tells a crawler nothing it can corroborate.
 */
export function personNode(author: SeoAuthor, site: SeoSite): JsonLdObject {
  return prune({
    "@type": "Person",
    "@id": personId(author, site),
    name: author.name,
    url: author.url ?? absoluteUrl(site, authorPath(author)),
    jobTitle: author.jobTitle ?? undefined,
    description: author.bio ?? undefined,
    image: author.avatarUrl ? absoluteUrl(site, author.avatarUrl) : undefined,
    sameAs: listOrUndefined(author.sameAs),
    knowsAbout: listOrUndefined(author.knowsAbout),
  });
}

export function personLd(author: SeoAuthor, site: SeoSite): JsonLdObject {
  return { "@context": SCHEMA_CONTEXT, ...personNode(author, site) };
}
