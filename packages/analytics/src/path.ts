/**
 * The join key.
 *
 * Every provider reports a page differently — Falorb may say `/blog/post/`,
 * Search Console says `https://spendtab.com/blog/post`, the CMS stores
 * `/blog/post` — and the entire value of this package is the join between
 * them. If two providers normalise even slightly differently, the join simply
 * misses and the merged table shows a page with impressions and no views next
 * to the same page with views and no impressions. That failure is silent,
 * which is why normalisation lives in one module both clients import rather
 * than being written twice.
 *
 * The shape chosen matches what the CMS stores: root-relative, no query, no
 * fragment, no trailing slash, root is exactly `/`.
 */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Reduces whatever a provider called a page to our path form.
 *
 * Returns `undefined` for input we cannot make sense of, so callers drop the
 * row rather than inventing a path — a row filed under `""` or `"undefined"`
 * would join against nothing and quietly distort every median computed later.
 *
 * The query string goes deliberately. `?utm_source=newsletter` is the same
 * document as the bare URL to an editor, and keeping them apart splits one
 * page's traffic across a dozen rows, none of which look worth acting on.
 */
export function normalizePath(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  let pathname = trimmed;

  if (HAS_SCHEME.test(trimmed) || trimmed.startsWith("//")) {
    try {
      // A protocol-relative URL has no scheme of its own; any scheme parses it,
      // and we only keep the pathname, so the invented `https:` never escapes.
      const url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
      pathname = url.pathname;
    } catch {
      return undefined;
    }
  } else {
    const cut = pathname.search(/[?#]/);
    if (cut >= 0) pathname = pathname.slice(0, cut);
  }

  const parts = pathname.split("/").filter((part) => part.length > 0);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}
