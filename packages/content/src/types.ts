/**
 * The public contract of the markdown pipeline.
 *
 * The editor's live preview, the publish-time lint gate and the published HTML
 * all go through `renderDocument`. That identity is the point: a preview that
 * ran a slightly different pipeline is a preview that lies, and a lint gate
 * that ran a different one blocks or passes on markup nobody will ever see.
 * So the types live here, apart from the implementation, and nothing else in
 * the system is allowed its own rendering path.
 */

/**
 * Bumped whenever rendered output can differ for unchanged input.
 *
 * It is mixed into `contentHash`, so a bump makes every cached render's hash
 * stale and the backfill job re-renders exactly the documents that need it.
 * Forgetting to bump is how half a site ends up on last month's markup.
 */
export const PIPELINE_VERSION = 1;

export interface RenderSiteContext {
  /** Consuming site origin, e.g. `https://spendtab.com`. No trailing slash required. */
  baseUrl: string;
  /** Where posts live on that site, e.g. `/blog`. */
  blogBasePath: string;
  /** BCP-47. */
  locale: string;
}

export interface HeadingEntry {
  depth: number;
  text: string;
  /** The live anchor id. Stable across edits — see `reconcileHeadings`. */
  id: string;
  /** Superseded slugs. Still emitted in the HTML so old citations resolve. */
  aliases: string[];
}

export interface ResolvedMedia {
  id: string;
  alt: string | null;
  caption?: string | null;
  width: number | null;
  height: number | null;
  blurhash?: string | null;
  /** Pre-built by `@cms/media`, widest last is not required — we sort. */
  variants: { url: string; width: number; format: string }[];
  /** Fallback `<img src>`. */
  src: string;
}

export interface RenderInput {
  markdown: string;
  slug: string;
  site: RenderSiteContext;
  /** Previous headings, so anchors stay stable. Omit on first render. */
  existingHeadings?: HeadingEntry[];
  /** Resolves `media://<id>` to a concrete asset. Injected; never fetched here. */
  resolveMedia?: (id: string) => ResolvedMedia | undefined;
  /** Frontmatter to embed in `mdPublic` (canonical, author, dates, entities). */
  publicFrontmatter?: Record<string, unknown>;
}

export interface QaBlock {
  question: string;
  answerMd: string;
  answerHtml: string;
  /** Frozen for the life of the question — FAQ rich results cite it. */
  anchorId: string;
  /** Which directive produced it. Today always `"faq"`. */
  kind: string;
}

/**
 * Ordered steps lifted out of a `:::howto`.
 *
 * Not part of the minimum contract, but `@cms/seo` cannot emit HowTo JSON-LD
 * without it, and re-parsing the rendered HTML to recover what we already knew
 * at the mdast stage is exactly the duplicated-pipeline problem this package
 * exists to avoid.
 */
export interface HowToBlock {
  name: string | null;
  steps: { text: string }[];
}

export type LintSeverity = "error" | "warning";

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  message: string;
  line?: number;
  column?: number;
}

export interface RenderResult {
  html: string;
  /** Plain text: readability lints, FTS, `llms-full.txt`. */
  text: string;
  /** The `/blog/<slug>.md` payload. Not a copy of the input. */
  mdPublic: string;
  headings: HeadingEntry[];
  qaBlocks: QaBlock[];
  tldr: string | null;
  keyTakeaways: string[];
  howtos: HowToBlock[];
  wordCount: number;
  readingTimeMinutes: number;
  lints: LintFinding[];
  /** sha256 of the markdown and `PIPELINE_VERSION`. */
  contentHash: string;
}
