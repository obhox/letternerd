/**
 * `media://<assetId>` references, resolved into responsive figures.
 *
 * Authors write `![alt](media://<id>)` so the markdown stays portable: it
 * survives a CDN move, a variant-set change and a re-encode without a single
 * edit. Resolution is injected — this package never reaches for a database or
 * a network, which is what lets the same function run inside a keystroke-driven
 * preview and inside the publish job.
 *
 * Intrinsic `width`/`height` are non-negotiable. Without them the browser
 * cannot reserve space, the text below the image jumps when it loads, and
 * Cumulative Layout Shift is a ranking signal — an image that arrives without
 * dimensions costs more than the image is worth.
 */

import type { ElementContent, Properties } from "hast";
import type { Image, Paragraph, Root, RootContent } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { applyElement, rawElement } from "./mdast-html";
import type { LintFinding, ResolvedMedia } from "./types";

export const MEDIA_PROTOCOL = "media://";

export type MediaResolver = (id: string) => ResolvedMedia | undefined;

export interface MediaHarvest {
  findings: LintFinding[];
  /** Ids that resolved, so `mdPublic` and the lints agree on what exists. */
  resolved: Map<string, ResolvedMedia>;
}

export function emptyMediaHarvest(): MediaHarvest {
  return { findings: [], resolved: new Map() };
}

export function mediaId(url: string): string | undefined {
  return url.startsWith(MEDIA_PROTOCOL) ? url.slice(MEDIA_PROTOCOL.length) : undefined;
}

/**
 * `sizes` for a one-column article.
 *
 * A constant rather than a knob: it has to match the consuming site's content
 * column, and a per-document override would let one post ship a `sizes` that
 * disagrees with the stylesheet and quietly download the wrong variant.
 */
const SIZES = "(max-width: 720px) 100vw, 720px";

function srcSet(media: ResolvedMedia): string | undefined {
  const entries = media.variants
    .filter((variant) => Number.isFinite(variant.width) && variant.width > 0)
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variant.url} ${variant.width}w`);
  return entries.length > 0 ? entries.join(", ") : undefined;
}

function imageProperties(media: ResolvedMedia, alt: string): Properties {
  const set = srcSet(media);
  return {
    src: media.src,
    alt,
    ...(media.width === null ? {} : { width: media.width }),
    ...(media.height === null ? {} : { height: media.height }),
    // Below-the-fold by assumption. The hero image of a post is set by the
    // template, not written into the body, so nothing here should ever be the
    // Largest Contentful Paint element.
    loading: "lazy",
    decoding: "async",
    ...(set ? { srcSet: set, sizes: SIZES } : {}),
    ...(media.blurhash ? { "data-blurhash": media.blurhash } : {}),
  };
}

function figure(media: ResolvedMedia, alt: string): RootContent {
  const children: ElementContent[] = [
    { type: "element", tagName: "img", properties: imageProperties(media, alt), children: [] },
  ];

  const caption = media.caption?.trim();
  if (caption) {
    children.push({
      type: "element",
      tagName: "figcaption",
      properties: {},
      children: [{ type: "text", value: caption }],
    });
  }

  return rawElement("figure", { className: ["cms-figure"] }, children) as RootContent;
}

/** A paragraph holding nothing but one image is really a figure. */
function soleImage(node: Paragraph): Image | undefined {
  const meaningful = node.children.filter(
    (child) => !(child.type === "text" && child.value.trim() === ""),
  );
  const first = meaningful[0];
  return meaningful.length === 1 && first?.type === "image" ? first : undefined;
}

export function transformMedia(
  tree: Root,
  resolve: MediaResolver | undefined,
  harvest: MediaHarvest,
): void {
  const unresolved = (node: Image, id: string) => {
    // Left in the tree on purpose. Deleting it would make the gap invisible to
    // the author, and the blocking lint below already guarantees the dangling
    // reference cannot reach a published page; the sanitiser drops the
    // `media:` src, so the worst rendered outcome is an empty `<img>`.
    harvest.findings.push({
      rule: "unresolved-media-ref",
      severity: "error",
      message: `Media reference "${MEDIA_PROTOCOL}${id}" could not be resolved.`,
      ...(node.position?.start
        ? { line: node.position.start.line, column: node.position.start.column }
        : {}),
    });
  };

  visit(tree, "paragraph", (node, index, parent) => {
    const image = soleImage(node);
    if (!image) return;
    const id = mediaId(image.url);
    if (id === undefined || !parent || typeof index !== "number") return;

    const media = resolve?.(id);
    if (!media) {
      unresolved(image, id);
      return;
    }
    harvest.resolved.set(id, media);

    // `alt` from the document wins over the asset's own: the same image can
    // legitimately need different alt text in two posts, and the author writing
    // the sentence around it is the one who knows which.
    const alt = image.alt?.trim() || media.alt?.trim() || "";
    parent.children.splice(index, 1, figure(media, alt) as never);
    return [SKIP, index + 1];
  });

  // Anything left is an image inline in a run of text. It still needs its
  // dimensions and its variants, but wrapping it in a `<figure>` would break
  // the sentence it sits in.
  visit(tree, "image", (node) => {
    const id = mediaId(node.url);
    if (id === undefined) return;

    const media = resolve?.(id);
    if (!media) {
      unresolved(node, id);
      return;
    }
    harvest.resolved.set(id, media);

    const alt = node.alt?.trim() || media.alt?.trim() || "";
    node.url = media.src;
    node.alt = alt;
    applyElement(node, undefined, imageProperties(media, alt));
  });
}
