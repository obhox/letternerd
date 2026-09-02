/**
 * Text similarity for heading reconciliation.
 *
 * Two measures are combined because they fail in different places. Edit
 * distance handles a typo fix or a punctuation change ("Pricing FAQs" ->
 * "Pricing FAQ") but collapses when a word is inserted into a short heading.
 * Token overlap handles insertions and reordering ("Getting started" ->
 * "Getting started with billing") but scores a typo as a completely different
 * token. Taking the better of the two means an edit only has to look small
 * under one of them, which is how humans read a rename.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeHeadingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Levenshtein distance, two rows rather than a full matrix.
 *
 * Headings are short, but this runs once per (new, candidate) pair on every
 * render including every keystroke-driven preview, so the allocation matters
 * more than the asymptotics.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] ?? 0;
}

function tokens(text: string): string[] {
  return text.length === 0 ? [] : text.split(" ");
}

/** Sørensen–Dice over the token multiset, which tolerates insertions. */
function tokenOverlap(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const remaining = new Map<string, number>();
  for (const token of right) remaining.set(token, (remaining.get(token) ?? 0) + 1);

  let shared = 0;
  for (const token of left) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      shared++;
      remaining.set(token, count - 1);
    }
  }

  return (2 * shared) / (left.length + right.length);
}

/** 1 for identical normalized text, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const left = normalizeHeadingText(a);
  const right = normalizeHeadingText(b);
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const distance = levenshtein(left, right);
  const edit = 1 - distance / Math.max(left.length, right.length);
  return Math.max(edit, tokenOverlap(left, right));
}
