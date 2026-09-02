/**
 * Stable heading anchors.
 *
 * An answer engine that cited `/blog/pricing#how-refunds-work` six months ago
 * still links there. If a later edit retitles that section, `github-slugger`
 * produces a new slug, the old fragment stops resolving, and the citation
 * silently degrades to a page-level link — the single most avoidable way to
 * lose accumulated GEO surface. So the computed slug is only a *proposal*:
 * a heading that can be matched to one we published before keeps the id it
 * already had, and the new slug is retained as an alias that still resolves.
 *
 * Ids therefore accrete. That is deliberate — they are a published URL surface,
 * not an implementation detail, and nothing here ever removes one.
 */

import { similarity } from "./similarity";
import type { HeadingEntry } from "./types";

/** A heading as it comes out of the tree, before reconciliation. */
export interface HeadingDraft {
  depth: number;
  text: string;
  /** What `github-slugger` produced for this render. */
  slug: string;
}

/**
 * How alike two headings must be to count as the same heading.
 *
 * The two errors are not symmetric. A false *match* freezes an old id onto
 * unrelated prose, so a citation keeps resolving but now points at the wrong
 * section — a wrong answer, served confidently. A false *non-match* mints a
 * fresh id, so the old fragment stops resolving and the reader lands at the
 * top of the right page. The second failure is plainly the cheaper one, so the
 * threshold sits high enough to be conservative.
 *
 * 0.6 is where the two measures in `similarity` separate real edits from real
 * rewrites: "Getting started" -> "Getting started with billing" scores 0.67 on
 * token overlap and "Pricing FAQ" -> "Pricing FAQs" scores 0.92 on edit
 * distance, while two different two-word headings that merely share one word
 * score 0.5 and are correctly refused.
 */
export const HEADING_MATCH_THRESHOLD = 0.6;

/**
 * How far a heading may move and still be recognised.
 *
 * Reordering sections is an edit; a heading that reappears eight positions away
 * with similar wording is more likely a different section that happens to use
 * the house vocabulary. Position is the tie-breaker the threshold alone cannot
 * provide.
 */
const POSITION_WINDOW = 3;

function isTaken(entry: HeadingEntry, id: string): boolean {
  return entry.id === id || entry.aliases.includes(id);
}

/**
 * Match `drafts` against `existing` and return the live heading table.
 *
 * Two passes. The first claims unambiguous identities — same normalized text,
 * or a computed slug the existing entry already answers to — anywhere in the
 * document, because a heading whose text is untouched is the same heading even
 * if six sections were inserted above it. The second pass then does fuzzy
 * matching, but only within `POSITION_WINDOW`, and takes the best score so a
 * near-tie between two candidates resolves the same way on every render.
 */
export function reconcileHeadings(
  drafts: readonly HeadingDraft[],
  existing: readonly HeadingEntry[] = [],
): HeadingEntry[] {
  const matched = new Array<HeadingEntry | undefined>(drafts.length).fill(undefined);
  const claimed = new Set<number>();

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!draft) continue;
    for (let j = 0; j < existing.length; j++) {
      if (claimed.has(j)) continue;
      const candidate = existing[j];
      if (!candidate) continue;
      if (similarity(draft.text, candidate.text) === 1 || isTaken(candidate, draft.slug)) {
        matched[i] = candidate;
        claimed.add(j);
        break;
      }
    }
  }

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!draft || matched[i]) continue;

    let best: { index: number; score: number } | undefined;
    const from = Math.max(0, i - POSITION_WINDOW);
    const to = Math.min(existing.length - 1, i + POSITION_WINDOW);
    for (let j = from; j <= to; j++) {
      if (claimed.has(j)) continue;
      const candidate = existing[j];
      if (!candidate) continue;
      const score = similarity(draft.text, candidate.text);
      if (score >= HEADING_MATCH_THRESHOLD && (!best || score > best.score)) {
        best = { index: j, score };
      }
    }

    if (best) {
      matched[i] = existing[best.index];
      claimed.add(best.index);
    }
  }

  // A matched id could in principle collide with one already emitted in this
  // render — two headings converging on the same text, say. Duplicate ids make
  // the fragment resolve arbitrarily, which is worse than losing one citation,
  // so the later heading falls back to its own computed slug.
  const used = new Set<string>();
  const result: HeadingEntry[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!draft) continue;
    const previous = matched[i];

    let id = previous && !used.has(previous.id) ? previous.id : draft.slug;
    if (used.has(id)) {
      let suffix = 1;
      while (used.has(`${draft.slug}-${suffix}`)) suffix++;
      id = `${draft.slug}-${suffix}`;
    }
    used.add(id);

    const aliases: string[] = [];
    for (const alias of previous?.aliases ?? []) {
      if (alias !== id && !aliases.includes(alias)) aliases.push(alias);
    }
    // The previous live id becomes an alias when it loses the collision above,
    // otherwise the newly computed slug does. Either way the URL that used to
    // work keeps working.
    for (const candidate of [previous?.id, draft.slug]) {
      if (candidate && candidate !== id && !aliases.includes(candidate)) aliases.push(candidate);
    }

    result.push({ depth: draft.depth, text: draft.text, id, aliases });
  }

  return result;
}
