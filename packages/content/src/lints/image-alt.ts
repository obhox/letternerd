/**
 * Alt text, and why this one blocks.
 *
 * Most editorial lints are advice. This one is not: an image with no alt text
 * is inaccessible to a screen reader and invisible to every text-only consumer
 * of the page, and unlike a long sentence it cannot be fixed after the fact by
 * anyone but the author who knows what the image shows. Publishing is the last
 * moment that person is still looking at it.
 */

import type { Root } from "mdast";
import { visit } from "unist-util-visit";
import { mediaId, type MediaResolver } from "../media.js";
import type { LintFinding } from "../types.js";

export const IMAGE_ALT_REQUIRED = "image-alt-required";

export function imageAltRequired(tree: Root, resolveMedia?: MediaResolver): LintFinding[] {
  const findings: LintFinding[] = [];

  visit(tree, "image", (node) => {
    // The asset's own alt text is a legitimate answer: `@cms/media` collects it
    // at upload, and requiring it to be restated in every post that uses the
    // image is how alt text ends up copy-pasted and wrong.
    const id = mediaId(node.url);
    const fallback = id === undefined ? undefined : resolveMedia?.(id)?.alt;
    if ((node.alt ?? "").trim().length > 0 || (fallback ?? "").trim().length > 0) return;

    const at = node.position?.start;
    findings.push({
      rule: IMAGE_ALT_REQUIRED,
      severity: "error",
      message: `Image "${node.url}" has no alt text.`,
      ...(at ? { line: at.line, column: at.column } : {}),
    });
  });

  return findings;
}
