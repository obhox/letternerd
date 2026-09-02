"use server";

import { revalidatePath } from "next/cache";
import { isBlocking, type LintFinding } from "@cms/content";
import { dispatch, studioContext, type DispatchFailure } from "@/server/context";
import type {
  ActionResult,
  DocumentDraft,
  EditorFinding,
  EditorHeading,
  EditorQaBlock,
  PreviewPayload,
  PublishedDocument,
  SavedDocument,
} from "./types";

/**
 * Every write and every render this screen performs.
 *
 * All three go through `dispatch`, which is the same path the MCP server and
 * the REST API take. The editor contains no rule of its own about who may
 * publish or what a blocked document is; it asks, and renders the answer.
 *
 * The site slug arrives from the client on each call and `studioContext`
 * re-resolves membership against it every time. That is deliberate: a browser
 * tab left open across a revoked membership must stop working, and the only
 * way to guarantee that is to never cache the decision.
 */

/** A capability's return type is not exported, so the columns we read are named here. */
interface DocumentRowShape {
  slug?: unknown;
  status?: unknown;
  updatedAt?: unknown;
  publishedAt?: unknown;
  scheduledFor?: unknown;
}

interface RenderPreviewShape {
  html?: unknown;
  headings?: unknown;
  qaBlocks?: unknown;
  tldr?: unknown;
  keyTakeaways?: unknown;
  wordCount?: unknown;
  readingTimeMinutes?: unknown;
  lints?: unknown;
  blocked?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Attach the publish gate's verdict to each finding.
 *
 * `isBlocking` is the single definition of "this refuses a publish", and it is
 * evaluated here — on the server, next to the gate — rather than restated in
 * the browser. Exactly three rules qualify; heading hierarchy and metadata
 * length are warnings and come back with `blocks: false`, which is what stops
 * the panel from threatening the author with a gate that does not exist.
 */
function toFinding(value: unknown): EditorFinding | null {
  if (!isRecord(value)) return null;
  const severity = value.severity === "error" ? "error" : "warning";
  const finding: LintFinding = {
    rule: str(value.rule, "unknown"),
    severity,
    message: str(value.message, ""),
    ...(typeof value.line === "number" ? { line: value.line } : {}),
    ...(typeof value.column === "number" ? { column: value.column } : {}),
  };

  return {
    rule: finding.rule,
    severity,
    message: finding.message,
    line: finding.line ?? null,
    column: finding.column ?? null,
    blocks: isBlocking(finding),
  };
}

function toFindings(value: unknown): EditorFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toFinding)
    .filter((finding): finding is EditorFinding => finding !== null);
}

function toHeadings(value: unknown): EditorHeading[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): EditorHeading[] => {
    if (!isRecord(entry)) return [];
    return [
      {
        depth: num(entry.depth, 2),
        text: str(entry.text, ""),
        id: str(entry.id, ""),
        aliases: Array.isArray(entry.aliases)
          ? entry.aliases.filter((a): a is string => typeof a === "string")
          : [],
      },
    ];
  });
}

function toQaBlocks(value: unknown): EditorQaBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): EditorQaBlock[] =>
    isRecord(entry)
      ? [{ question: str(entry.question, ""), anchorId: str(entry.anchorId, "") }]
      : [],
  );
}

/**
 * Turn a dispatch failure into something a client component can render.
 *
 * `details` is `Record<string, unknown>` by the time it reaches here, and the
 * two shapes worth surfacing are the publish gate's `findings` and input
 * validation's `issues`. Both are folded into the message or the finding list
 * so the editor never has to guess at an untyped bag.
 */
function toActionFailure(failure: DispatchFailure): ActionResult<never> {
  const findings = toFindings(failure.details.findings);

  let message = failure.message;
  if (failure.code === "invalid_input" && Array.isArray(failure.details.issues)) {
    const issues = failure.details.issues
      .flatMap((issue): string[] =>
        isRecord(issue)
          ? [
              [str(issue.path, ""), str(issue.message, "")]
                .filter((part) => part.length > 0)
                .join(": "),
            ]
          : [],
      )
      .filter((line) => line.length > 0);
    if (issues.length > 0) message = `${failure.message} ${issues.join("; ")}`;
  }

  return { ok: false, code: failure.code, message, findings };
}

/**
 * Render markdown through the publishing pipeline, without saving.
 *
 * This is the whole reason the preview is a server round trip. `render_preview`
 * runs `renderForSite` — the same function `publish_document` runs — so the
 * HTML in the preview pane, the anchors in the outline and the findings in the
 * checks panel are the ones that will actually ship. A client-side markdown
 * renderer would be a second pipeline, and a second pipeline is a preview that
 * eventually lies about what publishing will do.
 */
export async function renderPreviewAction(input: {
  siteSlug: string;
  documentId: string;
  slug: string;
  markdown: string;
}): Promise<ActionResult<PreviewPayload>> {
  const ctx = await studioContext(input.siteSlug);

  const result = await dispatch<RenderPreviewShape>(ctx, "render_preview", {
    markdown: input.markdown,
    // A blank slug would fail the capability's own validation; the preview
    // should keep working while an author is midway through retyping one.
    slug: input.slug.trim().length > 0 ? input.slug : "preview",
    documentId: input.documentId,
  });

  if (!result.ok) return toActionFailure(result);

  const data = result.data;
  return {
    ok: true,
    data: {
      html: str(data.html, ""),
      headings: toHeadings(data.headings),
      qaBlocks: toQaBlocks(data.qaBlocks),
      tldr: typeof data.tldr === "string" ? data.tldr : null,
      keyTakeaways: Array.isArray(data.keyTakeaways)
        ? data.keyTakeaways.filter((t): t is string => typeof t === "string")
        : [],
      wordCount: num(data.wordCount, 0),
      readingTimeMinutes: num(data.readingTimeMinutes, 1),
      lints: toFindings(data.lints),
      blocked: data.blocked === true,
    },
  };
}

/** Persist the draft. `update_document` writes a revision before it changes anything. */
export async function saveDocumentAction(input: {
  siteSlug: string;
  documentId: string;
  draft: DocumentDraft;
}): Promise<ActionResult<SavedDocument>> {
  const ctx = await studioContext(input.siteSlug);
  const { draft } = input;

  const canonical = draft.canonicalUrlOverride.trim();

  const result = await dispatch<DocumentRowShape>(ctx, "update_document", {
    id: input.documentId,
    slug: draft.slug,
    title: draft.title,
    description: draft.description,
    bodyMd: draft.bodyMd,
    noindex: draft.noindex,
    // The column is nullable and the capability validates a non-empty value as
    // a URL, so "cleared" has to travel as null rather than as "".
    canonicalUrlOverride: canonical.length > 0 ? canonical : null,
  });

  if (!result.ok) return toActionFailure(result);

  return {
    ok: true,
    data: {
      slug: str(result.data.slug, draft.slug),
      updatedAt: iso(result.data.updatedAt) ?? new Date().toISOString(),
    },
  };
}

/**
 * Publish, or schedule for a future `publishAt`.
 *
 * A `precondition_failed` here is not an outage and is not reported as one. It
 * is the lint gate refusing to ship something broken, and the findings it
 * carries are handed straight back so the editor can show them in place.
 */
export async function publishDocumentAction(input: {
  siteSlug: string;
  documentId: string;
  publishAt: string | null;
}): Promise<ActionResult<PublishedDocument>> {
  const ctx = await studioContext(input.siteSlug);

  const result = await dispatch<{ document?: DocumentRowShape }>(ctx, "publish_document", {
    id: input.documentId,
    ...(input.publishAt ? { publishAt: input.publishAt } : {}),
  });

  if (!result.ok) return toActionFailure(result);

  const doc = isRecord(result.data.document) ? result.data.document : {};

  // The listings and the overview carry a status badge and a published date,
  // both of which this call just changed.
  revalidatePath(`/${input.siteSlug}/posts`);

  const status = doc.status;
  return {
    ok: true,
    data: {
      status:
        status === "draft" ||
        status === "in_review" ||
        status === "scheduled" ||
        status === "published" ||
        status === "archived"
          ? status
          : "published",
      publishedAt: iso(doc.publishedAt),
      scheduledFor: iso(doc.scheduledFor),
      updatedAt: iso(doc.updatedAt) ?? new Date().toISOString(),
    },
  };
}
