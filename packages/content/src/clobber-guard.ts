/**
 * The pass that keeps author-controlled ids from clobbering the DOM.
 *
 * The sanitize schema sets `clobberPrefix: ""` on purpose: an anchor an answer
 * engine cited has to be the literal string in the HTML, so ids cannot be
 * rewritten to `user-content-…` the way GitHub does. What that gives up is the
 * only protection the sanitiser offers against DOM clobbering — a heading
 * called "Location" becomes `<h2 id="location">`, and on the consuming page
 * `window.location` is now that element for any script that reads globals by
 * name. This pass takes that protection back, narrowly, without touching the
 * ids that are fine.
 *
 * Two rules, applied to every element in the tree:
 *
 *   1. An id must look like a slug (`ID_PATTERN`). Anything else is removed.
 *   2. An id must not be a name a script would read off `window` or
 *      `document` (`RESERVED_IDS`). A heading that lands on one is suffixed —
 *      `location` becomes `location-1` — because losing the anchor would break
 *      a citation, while any other element simply loses the id.
 *
 * The suffix is chosen by `publishableHeadingId`, which is also what the
 * stable-anchor pass uses when it proposes a slug and what `reconcileHeadings`
 * consults before it reuses an id from a previous publish. That sharing is not
 * incidental: the heading table returned to the caller, the copy-link
 * `rehype-autolink-headings` appends and the id in the HTML must all agree,
 * and they can only agree if the id is decided once, before any of them read
 * it. So in practice this pass never renames a heading — it is the enforcement
 * that does not depend on the pipeline being ordered correctly, sitting last
 * before the sanitiser so nothing added after the anchor pass escapes it.
 *
 * The same pass also vets `srcset`. `hast-util-sanitize` checks the protocol
 * of `href`, `src`, `cite` and `longDesc` but does not parse `srcset`, so a
 * `javascript:` candidate would survive; that attribute is ours to check.
 */

import type { Element, Properties, Root } from "hast";
import { visit } from "unist-util-visit";

/**
 * What an id may look like: one to 128 characters drawn from what
 * `github-slugger` can emit — letters, digits, combining marks, `_` and `-`.
 *
 * Deliberately not ASCII-only. The slugger keeps Unicode letters, so a German
 * heading slugs to `über-uns` and a Japanese one to its own characters; an
 * ASCII rule would strip the anchor from every heading in a non-English post,
 * which is the opposite of stable citations. A leading `-` or `_` is allowed
 * for the same reason: the slugger emits one for a heading that starts with
 * punctuation, and refusing it would silently lose that anchor for no gain.
 * Nothing in this alphabet can close an attribute, start a selector or be
 * mistaken for a script name that the reserved list does not already cover.
 */
export const ID_PATTERN = /^[\p{L}\p{N}_-][\p{L}\p{N}\p{M}_-]{0,127}$/u;

/**
 * Ids that shadow something a script reads by name.
 *
 * A named element is reachable as `window.<id>` and `document.<id>`, and for
 * forms and images `document.forms.<id>` as well. This is the set of
 * properties that consuming-page scripts plausibly read without qualifying —
 * `location`, `document`, `top`, `name`, `origin` — plus the framework-shaped
 * words (`app`, `config`, `data`, `root`) that a page's own code tends to
 * hang off the global, and the prototype names that turn a lookup into a
 * gadget. Matched case-insensitively, since a slug is lowercase but a
 * hand-written id need not be.
 */
export const RESERVED_IDS: readonly string[] = [
  "location",
  "document",
  "window",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "cookie",
  "navigator",
  "history",
  "forms",
  "images",
  "links",
  "anchors",
  "scripts",
  "embeds",
  "plugins",
  "body",
  "head",
  "title",
  "name",
  "length",
  "closed",
  "status",
  "event",
  "origin",
  "referrer",
  "domain",
  "all",
  "nav",
  "header",
  "footer",
  "main",
  "root",
  "app",
  "config",
  "data",
  "settings",
  "constructor",
  "prototype",
  "__proto__",
  "toString",
  "valueOf",
  "hasOwnProperty",
];

const RESERVED = new Set(RESERVED_IDS.map((id) => id.toLowerCase()));

export function isReservedId(id: string): boolean {
  return RESERVED.has(id.toLowerCase());
}

export function isWellFormedId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** An id that can be published as-is: well formed and not reserved. */
export function isPublishableId(id: string): boolean {
  return isWellFormedId(id) && !isReservedId(id);
}

/**
 * The id a heading may publish under, given the slug it wanted.
 *
 * A reserved or already-taken slug is suffixed `-1`, `-2`, … until it is
 * neither, which is the same scheme `reconcileHeadings` uses for two headings
 * that slug identically — so "Location" gets `location-1` on every render,
 * and a citation of it stays valid. A slug that is malformed to begin with
 * (empty, or longer than an id may be) cannot be repaired by a suffix and
 * yields `undefined`: the heading is published without an anchor.
 */
export function publishableHeadingId(
  slug: string,
  taken: (candidate: string) => boolean = () => false,
): string | undefined {
  if (!isWellFormedId(slug)) return undefined;
  let candidate = slug;
  for (let suffix = 1; isReservedId(candidate) || taken(candidate); suffix++) {
    candidate = `${slug}-${suffix}`;
    if (!isWellFormedId(candidate)) return undefined;
  }
  return candidate;
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/* ---------------------------------------------------------------- srcset -- */

/** A candidate's URL is kept if it is http(s) or a root-relative path. */
function isAllowedSrcSetUrl(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return true;
  // `//host/path` is protocol-relative, not root-relative, and it is the one
  // shape that looks like a path while naming a different origin.
  return url.startsWith("/") && !url.startsWith("//");
}

interface SrcSetCandidate {
  url: string;
  descriptor: string;
}

/**
 * Split a `srcset` into candidates the way the HTML parser does.
 *
 * A naive split on commas is wrong in both directions: a URL may contain
 * commas, and the separator between candidates is a comma that follows the
 * descriptor, with or without whitespace. The spec's algorithm is: read a URL
 * up to whitespace; if it ends in commas, strip them and the candidate has no
 * descriptor; otherwise the descriptor runs to the next comma.
 */
function parseSrcSet(value: string): SrcSetCandidate[] {
  const candidates: SrcSetCandidate[] = [];
  let rest = value.trim();

  while (rest.length > 0) {
    const match = /^\S+/.exec(rest);
    if (!match) break;
    let url = match[0];
    rest = rest.slice(url.length);

    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (url.length > 0) candidates.push({ url, descriptor: "" });
      rest = rest.trimStart();
      continue;
    }

    const separator = rest.indexOf(",");
    const descriptor = (separator === -1 ? rest : rest.slice(0, separator)).trim();
    rest = separator === -1 ? "" : rest.slice(separator + 1).trimStart();
    candidates.push({ url, descriptor });
  }

  return candidates;
}

function serialiseSrcSet(candidates: SrcSetCandidate[]): string {
  return candidates
    .map(({ url, descriptor }) => (descriptor ? `${url} ${descriptor}` : url))
    .join(", ");
}

/**
 * hast stores comma-separated properties either as the raw string or as an
 * array of the pieces, depending on who wrote them. Both read back the same.
 */
function srcSetText(value: Properties[string]): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(", ");
  return undefined;
}

function guardSrcSet(properties: Properties): void {
  const text = srcSetText(properties["srcSet"]);
  if (text === undefined) {
    delete properties["srcSet"];
    return;
  }

  const kept = parseSrcSet(text).filter((candidate) => isAllowedSrcSetUrl(candidate.url));
  if (kept.length === 0) delete properties["srcSet"];
  else properties["srcSet"] = serialiseSrcSet(kept);
}

/* ------------------------------------------------------------------ pass -- */

export function rehypeClobberGuard() {
  return (tree: Root): void => {
    // Every id in the document, so a suffix chosen for one heading cannot
    // collide with an id that appears later in the tree.
    const used = new Set<string>();
    visit(tree, "element", (node) => {
      const id = node.properties?.["id"];
      if (typeof id === "string") used.add(id);
    });

    visit(tree, "element", (node: Element) => {
      const properties = node.properties;
      if (!properties) return;

      if ("id" in properties) {
        const id = properties["id"];
        if (typeof id !== "string" || !isWellFormedId(id)) {
          delete properties["id"];
        } else if (isReservedId(id)) {
          const replacement = HEADING_TAGS.has(node.tagName)
            ? publishableHeadingId(id, (candidate) => used.has(candidate))
            : undefined;
          if (replacement === undefined) delete properties["id"];
          else {
            properties["id"] = replacement;
            used.add(replacement);
          }
        }
      }

      if ("srcSet" in properties) guardSrcSet(properties);
    });
  };
}
