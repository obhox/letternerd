/**
 * Text measured the way a search engine measures it: in pixels.
 *
 * Every SEO tool that reports "58 of 60 characters" is measuring the wrong
 * thing. Google truncates a result when the rendered string exceeds a pixel
 * width, and proportional type means characters are not interchangeable — a
 * title of thirty `W`s is far wider than a title of thirty `i`s, and only one
 * of them survives. Counting characters gets both wrong in opposite
 * directions, so this module renders the string to a canvas and asks the same
 * question the browser asks.
 *
 * The fonts and limits below are the desktop result page's, and they are
 * approximations of someone else's rendering rather than a contract. That is
 * why the panel shows the measured width and the limit side by side instead of
 * a bare pass/fail: an author can see how close they are and judge it.
 */

/** Google renders desktop result titles at roughly 20px Arial. */
export const SERP_TITLE_FONT = "20px Arial, Helvetica, sans-serif";
/** …and the snippet beneath at roughly 14px Arial. */
export const SERP_DESCRIPTION_FONT = "14px Arial, Helvetica, sans-serif";

/** Width of a desktop result title before it is cut. */
export const SERP_TITLE_LIMIT_PX = 600;
/** Two lines of snippet. */
export const SERP_DESCRIPTION_LIMIT_PX = 920;

const ELLIPSIS = "…";

let cached: CanvasRenderingContext2D | null = null;

/**
 * One offscreen canvas for the whole screen.
 *
 * `measureText` is cheap; constructing a canvas per keystroke is not, and this
 * runs on every character an author types into the title field.
 */
function context(): CanvasRenderingContext2D | null {
  if (cached) return cached;
  // Rendered on the server first, where there is no canvas to measure with.
  // Nothing is memoised in that case, so the browser still gets a real one.
  if (typeof document === "undefined") return null;
  cached = document.createElement("canvas").getContext("2d");
  return cached;
}

/** Measured width in CSS pixels, or `null` where no canvas is available. */
export function measureWidth(text: string, font: string): number | null {
  const ctx = context();
  if (!ctx) return null;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export interface FittedText {
  /** What a search result would actually show, ellipsis included. */
  shown: string;
  /** Width of the full string, which is the number worth reporting. */
  width: number;
  truncated: boolean;
}

/**
 * The longest prefix that fits, cut back to a word boundary.
 *
 * The search is a binary one over code points rather than UTF-16 units, so a
 * cut never lands in the middle of an emoji or an accented character and
 * produces a lone surrogate.
 */
export function fitToWidth(text: string, font: string, limitPx: number): FittedText | null {
  const width = measureWidth(text, font);
  if (width === null) return null;
  if (width <= limitPx) return { shown: text, width, truncated: false };

  const points = Array.from(text);
  const ellipsisWidth = measureWidth(ELLIPSIS, font) ?? 0;
  const budget = limitPx - ellipsisWidth;

  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = points.slice(0, mid).join("");
    if ((measureWidth(candidate, font) ?? Infinity) <= budget) low = mid;
    else high = mid - 1;
  }

  const clipped = points.slice(0, low).join("");
  // Prefer a word boundary, but only a nearby one — backing off half a title
  // to avoid breaking one long word would misrepresent what is shown.
  const lastSpace = clipped.lastIndexOf(" ");
  const atWord = lastSpace > clipped.length * 0.6 ? clipped.slice(0, lastSpace) : clipped;

  return { shown: `${atWord.trimEnd()}${ELLIPSIS}`, width, truncated: true };
}
