/**
 * Open Graph card rendering — interface now, implementation later.
 *
 * This is a stub on purpose. The shape is what other packages need in order to
 * be written: the publish path wants to know that generating a card is
 * `(inputs) -> Buffer` and that its key is derived from a hash of those inputs
 * (see `ogKey`), and it can be built and reviewed against that contract before
 * a renderer exists. Fixing the signature now is cheaper than reworking every
 * call site once one does.
 *
 * When it lands it will use **satori** (JSX to SVG, with a real text layout
 * engine) followed by **resvg-js** (SVG to PNG). Deliberately not `@vercel/og`,
 * which wraps the same two libraries but assumes the Vercel edge runtime for
 * font loading and WASM instantiation; this deploys to Coolify on plain Node,
 * where that coupling is a liability rather than a convenience.
 *
 * The two open questions the implementation must answer: which fonts ship in
 * the image (satori needs real font buffers — it does not use system fonts),
 * and whether rendering happens on publish or lazily on first crawl.
 */

/**
 * A named layout, not free-form markup.
 *
 * Templates are an enum rather than user-supplied JSX because an OG card is
 * rendered server-side from document content: accepting arbitrary markup would
 * make it a rendering surface for untrusted input.
 */
export type OgTemplate = "article" | "page" | "site";

export interface OgImageInput {
  template: OgTemplate;
  title: string;
  /** Kicker or description under the title; omitted templates ignore it. */
  subtitle?: string;
  /** Site name in the corner. */
  siteName?: string;
  /** Public URL of an image to composite behind the text — a document's hero. */
  backgroundUrl?: string;
  /** Brand colour, `#rrggbb`. */
  accentColor?: string;
  /** Defaults to the 1200x630 that every crawler expects. */
  width?: number;
  height?: number;
}

/** 1200x630 is the size Facebook, X, LinkedIn and Slack all crop to without letterboxing. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export async function generateOgImage(input: OgImageInput): Promise<Buffer> {
  void input;
  throw new Error("not implemented");
}
