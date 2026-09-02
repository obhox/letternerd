/**
 * The rehype pass that makes heading anchors survive editing.
 *
 * `rehype-slug` has already put a freshly computed slug on every heading by the
 * time this runs. That slug is only a proposal: this pass reconciles it against
 * the ids the document published last time, promotes the previously-live id
 * back onto the heading, and leaves the superseded slugs behind as empty
 * anchor spans so a URL that used to resolve still does.
 *
 * It sits before `rehype-autolink-headings` on purpose — the copy-link control
 * that plugin appends must point at the id a reader would be citing, not at the
 * slug this render happened to compute.
 */

import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root } from "hast";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";
import { reconcileHeadings, type HeadingDraft } from "./anchors.js";
import type { HeadingEntry } from "./types.js";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Marks the heading of a FAQ question so its frozen id can be read back. */
export const QA_MARKER = "data-cms-qa";

export interface AnchorHarvest {
  headings: HeadingEntry[];
  /** `data-cms-qa` index to the live anchor id of that question. */
  qaAnchors: Map<number, string>;
}

export function emptyAnchorHarvest(): AnchorHarvest {
  return { headings: [], qaAnchors: new Map() };
}

export interface StableAnchorOptions {
  existingHeadings?: readonly HeadingEntry[];
  harvest: AnchorHarvest;
}

function aliasSpan(id: string): ElementContent {
  return {
    type: "element",
    tagName: "span",
    properties: { id, className: ["cms-anchor-alias"], ariaHidden: "true" },
    children: [],
  };
}

export function rehypeStableAnchors(options: StableAnchorOptions) {
  return (tree: Root): void => {
    const headings: Element[] = [];
    visit(tree, "element", (node) => {
      if (HEADING_TAGS.has(node.tagName)) headings.push(node);
    });

    const slugger = new GithubSlugger();
    const drafts: HeadingDraft[] = headings.map((node) => {
      const text = toString(node);
      const existing = node.properties?.["id"];
      return {
        depth: Number(node.tagName.slice(1)),
        text,
        // `rehype-slug` fills this in for us. The fallback only matters if a
        // caller reorders the pipeline, and losing an anchor entirely is worse
        // than an occasionally duplicated one — which `reconcileHeadings`
        // resolves anyway.
        slug: typeof existing === "string" && existing.length > 0 ? existing : slugger.slug(text),
      };
    });

    const entries = reconcileHeadings(drafts, options.existingHeadings ?? []);
    options.harvest.headings = entries;

    for (const [index, node] of headings.entries()) {
      const entry = entries[index];
      if (!entry) continue;

      const properties = (node.properties ??= {});
      properties["id"] = entry.id;

      // Prepended rather than appended so the browser scrolls to the top of the
      // heading when an old fragment is used, exactly as it does for the live
      // id, and so `rehype-autolink-headings` still ends up last.
      if (entry.aliases.length > 0) {
        node.children.unshift(...entry.aliases.map(aliasSpan));
      }

      const marker = properties[QA_MARKER];
      if (typeof marker === "string") {
        const qaIndex = Number.parseInt(marker, 10);
        if (Number.isInteger(qaIndex)) options.harvest.qaAnchors.set(qaIndex, entry.id);
      }
    }
  };
}
