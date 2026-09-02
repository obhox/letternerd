/**
 * Building HTML elements that mdast has no node type for.
 *
 * `mdast-util-to-hast` lets any node override the element it becomes through
 * `data.hName`, `data.hProperties` and `data.hChildren`. That is the supported
 * escape hatch and it is how remark-directive's own documentation says to
 * render directives, so the pipeline stays a plain unified pipeline with no
 * raw-HTML stage — which matters, because `allowDangerousHtml` is off and a
 * raw-HTML stage is precisely the hole that setting exists to close.
 *
 * `blockquote` is the carrier node. It is arbitrary: any mdast type whose
 * handler emits an element and whose children are block content would do, and
 * blockquote is the one whose *types* accept block children, so the trees we
 * build here typecheck instead of needing a cast at every call site.
 */

import type { ElementContent, Properties } from "hast";
import type { Blockquote, BlockContent, DefinitionContent } from "mdast";

export type BlockChild = BlockContent | DefinitionContent;

/** An element whose children are ordinary mdast, rendered as usual. */
export function element(
  tagName: string,
  properties: Properties,
  children: BlockChild[],
): Blockquote {
  return {
    type: "blockquote",
    data: { hName: tagName, hProperties: properties },
    children,
  };
}

/**
 * An element whose children are hast written out by hand.
 *
 * Used where the exact markup is load-bearing and no mdast node describes it —
 * a `<figure>` with `srcset`/`sizes`/intrinsic dimensions, or an embed facade.
 */
export function rawElement(
  tagName: string,
  properties: Properties,
  hChildren: ElementContent[],
): Blockquote {
  return {
    type: "blockquote",
    data: { hName: tagName, hProperties: properties, hChildren },
    children: [],
  };
}

/** Attach or merge presentation data onto a node that already exists. */
export function applyElement(
  node: { data?: { hName?: string; hProperties?: Properties } },
  tagName: string | undefined,
  properties: Properties,
): void {
  const data = (node.data ??= {});
  if (tagName) data.hName = tagName;
  data.hProperties = { ...data.hProperties, ...properties };
}
