/**
 * The shape of the Acme demo corpus.
 *
 * The fixtures are data, not code: every file under `scripts/demo` describes
 * what should exist, and `seed-demo.ts` is the only thing that talks to the
 * capability layer. Keeping that line sharp is what makes the corpus editable
 * by someone who has never read the seeder — adding a post is adding an entry
 * to an array, not learning the order in which `tag_document` has to be called.
 *
 * Keys rather than ids run through all of it. A fixture cannot know the uuid a
 * capability is about to mint, so it names an author as `"maya"` and an image
 * as `"chartCloseCycle"`, and the seeder resolves those against what it created
 * in this run. That is also what makes a re-run safe: nothing here is stamped
 * with a value from a previous run.
 */

export type AuthorKey = "maya" | "daniel" | "priya" | "tom";

export type CategoryKey = "guides" | "product" | "engineering" | "customer-stories";

export type TagKey =
  | "expense-policy"
  | "corporate-cards"
  | "month-end-close"
  | "soc-2"
  | "approvals"
  | "reimbursements"
  | "accounts-payable"
  | "travel"
  | "audit"
  | "integrations"
  | "api"
  | "forecasting";

export type EntityKey =
  | "expense-management"
  | "software-as-a-service"
  | "accounting"
  | "gaap"
  | "soc-2-reports"
  | "corporate-travel-management"
  | "internal-control"
  | "corporate-card"
  | "acme";

/**
 * Images are named by the job they do, not by their filename.
 *
 * A body that said `media://...` could not be written before the upload, and a
 * body that said `receipt-capture.png` would break the moment the file was
 * renamed. The slot name is the stable thing, and the seeder rewrites
 * `{{media:receiptCapture}}` into the real ref once the asset exists.
 */
export type MediaSlot =
  | "coverExpensePolicy"
  | "chartCloseCycle"
  | "dashboardSpend"
  | "quoteNorthwind"
  | "flowApprovals"
  | "receiptCapture"
  | "avatarMaya"
  | "avatarDaniel"
  | "avatarPriya";

export interface ImageFixture {
  slot: MediaSlot;
  filename: string;
  width: number;
  height: number;
  /**
   * Null on exactly one asset, deliberately.
   *
   * The library's "missing alt text" queue and the publish gate are both
   * invisible on a corpus where every image is already described, and a
   * screenshot of an empty warning state sells nothing.
   */
  alt: string | null;
  caption?: string;
  credit?: string;
}

export interface AuthorFixture {
  key: AuthorKey;
  slug: string;
  name: string;
  jobTitle?: string;
  bioMd?: string;
  email?: string;
  url?: string;
  sameAs?: string[];
  knowsAbout?: string[];
  credentials?: Record<string, unknown>;
  avatar?: MediaSlot;
  /** Which seeded studio login, if any, owns this byline. */
  account?: "owner" | "editor";
}

export interface CategoryFixture {
  key: CategoryKey;
  slug: string;
  name: string;
  description: string;
  position: number;
}

export interface TagFixture {
  key: TagKey;
  slug: string;
  name: string;
  description: string;
}

export interface EntityFixture {
  key: EntityKey;
  slug: string;
  name: string;
  type: "Thing" | "Product" | "Organization" | "SoftwareApplication" | "CreativeWork";
  description: string;
  aliases?: string[];
  sameAs: string[];
  /**
   * Verified against the Wikidata API, or null.
   *
   * A wrong Q-number is worse than none: it hands an answer engine a confident
   * pointer at the wrong subject, and nothing downstream will ever question it.
   * So the rule for this file is that an id is either looked up or absent.
   */
  wikidataId: string | null;
}

/** Where a document should end up once the seeder has finished with it. */
export type DocumentState =
  | { kind: "published"; publishedAt: string; updatedAt?: string }
  | { kind: "scheduled"; publishAt: string }
  | { kind: "draft"; createdAt: string }
  | { kind: "in_review"; createdAt: string }
  | { kind: "archived"; publishedAt: string };

export interface DocumentFixture {
  type: "post" | "page" | "block";
  slug: string;
  /**
   * The slug this document first went live under.
   *
   * Set on exactly one post so that `update_document` writes a real
   * `slug_history` row the way it would in production — a redirect nobody had
   * to remember to create is the whole point of that table, and it cannot be
   * demonstrated by inserting the row by hand.
   */
  previousSlug?: string;
  title: string;
  description: string;
  bodyMd: string;
  author: AuthorKey;
  /** A reviewer credit, which is an E-E-A-T signal in its own right. */
  reviewer?: AuthorKey;
  category?: CategoryKey;
  tags: TagKey[];
  entities: { key: EntityKey; salience: number; primary?: boolean }[];
  cover?: MediaSlot;
  state: DocumentState;
  /**
   * This document is expected to be refused by the lint gate.
   *
   * A refusal is the gate working, and the seeder treats an unexpected pass on
   * one of these as a failure — a demo that quietly stops demonstrating the
   * gate is worse than one that never tried.
   */
  expectBlocked?: boolean;
}
