/**
 * The body's heading outline.
 *
 * Two failures, both of which cost the same thing: a document whose outline a
 * parser cannot reconstruct is a document an answer engine will not quote a
 * section of. A second H1 splits the page's topic in two, and a jump from H2 to
 * H4 leaves a subsection with no parent.
 */

import type { Root } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { isDirective } from "../directives.js";
import type { LintFinding } from "../types.js";

export const HEADING_HIERARCHY = "heading-hierarchy";

export function headingHierarchy(tree: Root): LintFinding[] {
  const findings: LintFinding[] = [];
  let previousDepth: number | undefined;

  visit(tree, (node) => {
    // Headings inside a directive are structure this pipeline generates —
    // `:::faq` emits H3 questions under a section with no H2 of its own — so
    // holding them to the body's outline would fire on every correct document.
    if (isDirective(node)) return SKIP;
    if (node.type !== "heading") return;

    const at = node.position?.start;
    const where = at ? { line: at.line, column: at.column } : {};

    if (node.depth === 1) {
      findings.push({
        rule: HEADING_HIERARCHY,
        severity: "warning",
        message:
          "The body contains an H1. The document title is the page's only H1 — start body sections at H2.",
        ...where,
      });
    } else if (previousDepth !== undefined && node.depth > previousDepth + 1) {
      findings.push({
        rule: HEADING_HIERARCHY,
        severity: "warning",
        message: `Heading level jumps from H${previousDepth} to H${node.depth}.`,
        ...where,
      });
    }

    previousDepth = node.depth;
    return;
  });

  return findings;
}
