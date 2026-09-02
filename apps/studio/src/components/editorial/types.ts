/**
 * The shapes the editorial capabilities return.
 *
 * Declared here rather than inferred from `@cms/capabilities` because the
 * registry's public entry point is owned by the module that assembles it, and
 * a screen should not be blocked on that wiring. They are structural, so the
 * day `editorial.ts` is re-exported these can be replaced by
 * `Awaited<ReturnType<typeof listAuthors.invoke>>` with no other change.
 */

export interface AuthorReferences {
  /** Documents whose visible byline is this author. */
  asPrimary: number;
  /** Co-author and reviewer credits. */
  asByline: number;
}

export interface AuthorRow {
  id: string;
  slug: string;
  name: string;
  /** Null for a guest contributor — a byline is not a login. */
  userId: string | null;
  jobTitle: string | null;
  bioMd: string | null;
  avatarAssetId: string | null;
  email: string | null;
  url: string | null;
  sameAs: string[];
  knowsAbout: string[];
  isActive: boolean;
  references: AuthorReferences;
}

export type TermKind = "tag" | "category" | "entity";

export interface TermRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  documentCount: number;
  /** Categories only. */
  parentId?: string | null;
  position?: number;
  /** Entities only. */
  type?: string;
  aliases?: string[];
  sameAs?: string[];
  wikidataId?: string | null;
}

export interface RedirectRow {
  id: string;
  source: string;
  destination: string;
  statusCode: number;
  isExternal: boolean;
  hits: number;
}

/**
 * A slug change that already happened.
 *
 * Every field here is a fact, not a setting: the studio renders these and
 * offers nothing that edits one.
 */
export interface SlugHistoryRow {
  id: string;
  oldSlug: string;
  newSlug: string;
  statusCode: number;
  createdAt: string | Date;
  documentId: string;
  documentTitle: string;
  documentSlug: string;
  documentStatus: string;
}

export interface ChainRule {
  id: string;
  source: string;
  destination: string;
  origin: "manual" | "slug_history";
}

export interface RedirectChain {
  from: ChainRule;
  to: ChainRule;
}
