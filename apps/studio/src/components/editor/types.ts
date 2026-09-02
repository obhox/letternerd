import type { DocumentStatus } from "@cms/ui";

/**
 * The shapes that cross the boundary between this screen's server actions and
 * its client components.
 *
 * They are written out here rather than inferred from the capability layer for
 * two reasons. The capabilities do not export their return types, so there is
 * nothing to infer from; and everything below has to survive being serialised
 * through a server action, which rules out the Drizzle row objects and the
 * `Date` fields they carry. Timestamps therefore cross as ISO strings and are
 * turned back into dates at the point of display.
 *
 * `@cms/content` is imported for types only, never for values. Its entry point
 * pulls in the whole unified/remark pipeline, and a value import from a client
 * component would ship the markdown renderer to the browser — the exact
 * duplication the live preview exists to prevent.
 */

export type DocumentType = "post" | "page" | "block";

export interface EditorSite {
  slug: string;
  name: string;
  /** Origin of the consuming site, e.g. `https://spendtab.com`. */
  baseUrl: string;
  /** Where posts live on that site, e.g. `/blog`. */
  blogBasePath: string;
}

/** The columns of a document row this screen actually reads. */
export interface EditorDocument {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  slug: string;
  title: string;
  description: string | null;
  bodyMd: string;
  noindex: boolean;
  canonicalUrlOverride: string | null;
  updatedAt: string;
  publishedAt: string | null;
  scheduledFor: string | null;
}

/**
 * A lint finding, plus the one fact the client cannot work out for itself.
 *
 * Whether a finding blocks a publish is decided by `isBlocking` in
 * `packages/content/src/lints/index.ts`, and that set has exactly one
 * definition on purpose. Rather than copy it into the browser — where it would
 * quietly drift from the gate that actually refuses the publish — the server
 * evaluates it per finding and sends the answer along.
 */
export interface EditorFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  line: number | null;
  column: number | null;
  /** True only for findings the publish gate will actually refuse. */
  blocks: boolean;
}

export interface EditorHeading {
  depth: number;
  text: string;
  /** The stable citation anchor. Authors need to be able to see and copy it. */
  id: string;
  aliases: string[];
}

export interface EditorQaBlock {
  question: string;
  anchorId: string;
}

/** One `render_preview` response. Every panel on the screen reads from this. */
export interface PreviewPayload {
  html: string;
  headings: EditorHeading[];
  qaBlocks: EditorQaBlock[];
  tldr: string | null;
  keyTakeaways: string[];
  wordCount: number;
  readingTimeMinutes: number;
  lints: EditorFinding[];
  blocked: boolean;
}

/** The fields a save may change, and the unit both autosave and Cmd-S send. */
export interface DocumentDraft {
  slug: string;
  title: string;
  description: string;
  bodyMd: string;
  noindex: boolean;
  canonicalUrlOverride: string;
}

export interface SavedDocument {
  slug: string;
  updatedAt: string;
}

export interface PublishedDocument {
  status: DocumentStatus;
  publishedAt: string | null;
  scheduledFor: string | null;
  updatedAt: string;
}

export interface RevisionEntry {
  id: string;
  revisionNumber: number;
  title: string | null;
  description: string | null;
  bodyMd: string;
  note: string | null;
  createdAt: string;
}

export interface ActionFailure {
  ok: false;
  code: string;
  message: string;
  /** Populated on `precondition_failed` from `details.findings`; else empty. */
  findings: EditorFinding[];
}

export type ActionResult<T> = { ok: true; data: T } | ActionFailure;

/** Character bounds for the meta description, sourced from the lint rule. */
export interface LengthRange {
  min: number;
  max: number;
}
