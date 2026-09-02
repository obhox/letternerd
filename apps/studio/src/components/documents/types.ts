import type { DocumentStatus } from "@cms/ui";

/**
 * The shape of one row as `search_content` returns it, and the small amount of
 * per-type vocabulary the three list screens differ by.
 *
 * The capability's return type is not exported from the capability layer, so
 * this is a hand-written mirror of the columns its handler selects. Keeping it
 * in one place means a change there breaks one file rather than four.
 */

export const DOCUMENT_TYPES = ["post", "page", "block"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentSummary {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  slug: string;
  title: string;
  description: string | null;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
  readingTimeMinutes: number;
  wordCount: number;
  /**
   * Free-form JSON on the row, so it arrives untyped and is narrowed at the
   * point of use. See `summarizeLintReport`.
   */
  lintReport: unknown;
  /**
   * Absent today: `search_content` returns no byline, and there is no
   * capability that resolves an author id to a name. The column is driven by
   * this field so it appears the moment the listing starts carrying one.
   */
  authorName?: string | null;
}

export interface DocumentPage {
  documents: DocumentSummary[];
  nextCursor: string | null;
}

interface TypeMeta {
  /** The URL segment this type lives under, and where its editor is. */
  section: string;
  singular: string;
  plural: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
}

export const TYPE_META: Record<DocumentType, TypeMeta> = {
  post: {
    section: "posts",
    singular: "post",
    plural: "posts",
    title: "Posts",
    description: "Articles that appear in feeds, the sitemap and llms.txt.",
    emptyTitle: "No posts yet",
    emptyDescription: "Posts are the articles this site publishes. Write the first one.",
  },
  page: {
    section: "pages",
    singular: "page",
    plural: "pages",
    title: "Pages",
    description: "Standalone pages addressed by path rather than by feed position.",
    emptyTitle: "No pages yet",
    emptyDescription: "Pages hold standing content — about, pricing, contact.",
  },
  block: {
    section: "blocks",
    singular: "block",
    plural: "blocks",
    title: "Blocks",
    description: "Reusable fragments embedded into posts and pages by key.",
    emptyTitle: "No blocks yet",
    emptyDescription:
      "Blocks are fragments you write once and embed in many documents.",
  },
};

/**
 * Where a document's editor lives.
 *
 * One editor serves all three types, and it is mounted under `posts` — a
 * document is a document once it is open, and three copies of a markdown
 * editor differing only in their URL would be three places for the publish
 * gate to be implemented slightly differently. `section` above stays
 * per-type because the *lists* really are three screens.
 */
export function editorHref(siteSlug: string, doc: { id: string; type: DocumentType }): string {
  return `/${siteSlug}/posts/${doc.id}`;
}
