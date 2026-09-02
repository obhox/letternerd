/**
 * Title and meta description length.
 *
 * Both are budgets, not rules: a search result truncates what does not fit, and
 * a description under the floor usually means the snippet gets replaced by
 * whatever the crawler decides is representative. Neither is worth blocking a
 * publish over — a truncated title still ranks — so both are warnings the
 * author can knowingly ignore.
 *
 * These only run when `publicFrontmatter` is supplied. In the editor's live
 * preview there is no frontmatter yet, and warning about a description nobody
 * has written is noise while somebody is still typing the first paragraph.
 */

import type { LintFinding } from "../types.js";

export const META_DESCRIPTION_LENGTH = "meta-description-length";
export const TITLE_LENGTH = "title-length";

/** Google truncates the description around 160 characters on desktop. */
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 158;

/** Titles are truncated by pixel width; 60 characters is the usual proxy. */
export const TITLE_MIN = 30;
export const TITLE_MAX = 60;

function read(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function metadataLengths(
  publicFrontmatter: Record<string, unknown> | undefined,
): LintFinding[] {
  if (!publicFrontmatter) return [];
  const findings: LintFinding[] = [];

  const title = read(publicFrontmatter, "seoTitle", "title");
  if (title === undefined) {
    findings.push({
      rule: TITLE_LENGTH,
      severity: "warning",
      message: "No title in the public frontmatter.",
    });
  } else if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    findings.push({
      rule: TITLE_LENGTH,
      severity: "warning",
      message: `Title is ${title.length} characters; aim for ${TITLE_MIN}-${TITLE_MAX}.`,
    });
  }

  const description = read(publicFrontmatter, "metaDescription", "description");
  if (description === undefined) {
    findings.push({
      rule: META_DESCRIPTION_LENGTH,
      severity: "warning",
      message: "No meta description in the public frontmatter.",
    });
  } else if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    findings.push({
      rule: META_DESCRIPTION_LENGTH,
      severity: "warning",
      message: `Meta description is ${description.length} characters; aim for ${DESCRIPTION_MIN}-${DESCRIPTION_MAX}.`,
    });
  }

  return findings;
}
